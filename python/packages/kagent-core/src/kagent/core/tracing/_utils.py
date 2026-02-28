import logging
import os

from fastapi import FastAPI
from opentelemetry import _logs, metrics, trace
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.sdk._events import EventLoggerProvider
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from ._span_processor import KagentAttributesSpanProcessor


def _resolve_otlp_timeout_seconds(signal: str) -> float:
    """
    Resolve OTLP timeout env vars (milliseconds) into seconds for exporters.
    By default, Python OTLP exporter reads timeout env var as seconds.
    However, OTEL spec defines timeout as milliseconds.
    """
    signal_timeout_env = f"OTEL_EXPORTER_OTLP_{signal}_TIMEOUT"
    raw_timeout = os.getenv(signal_timeout_env) or os.getenv("OTEL_EXPORTER_OTLP_TIMEOUT")
    if raw_timeout is None:
        # OTEL spec default is 10000ms
        return 10.0

    try:
        timeout_millis = float(raw_timeout)
    except ValueError:
        logging.warning(
            "Invalid OTEL timeout value %r from %s; falling back to 10000ms",
            raw_timeout,
            signal_timeout_env,
        )
        return 10.0

    if timeout_millis < 0:
        logging.warning(
            "Negative OTEL timeout value %r from %s; falling back to 10000ms",
            raw_timeout,
            signal_timeout_env,
        )
        return 10.0

    return timeout_millis / 1000.0


def _instrument_anthropic(event_logger_provider=None):
    """Instrument Anthropic SDK if available."""
    try:
        from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor

        if event_logger_provider:
            AnthropicInstrumentor(use_legacy_attributes=False).instrument(event_logger_provider=event_logger_provider)
        else:
            AnthropicInstrumentor().instrument()
    except ImportError:
        # Anthropic SDK is not installed; skipping instrumentation.
        pass


def _instrument_google_generativeai():
    """Instrument Google GenerativeAI SDK if available."""
    try:
        from opentelemetry.instrumentation.google_generativeai import GoogleGenerativeAiInstrumentor

        GoogleGenerativeAiInstrumentor().instrument()
    except ImportError:
        # Google GenerativeAI SDK is not installed; skipping instrumentation.
        pass


def configure(name: str = "kagent", namespace: str = "kagent", fastapi_app: FastAPI | None = None):
    """Configure OpenTelemetry tracing, logging, and metrics for this service.

    This sets up OpenTelemetry providers and exporters for tracing, logging,
    and metrics, using environment variables to determine whether each is enabled.

    Providers are configured before instrumentors so that instrumentors can
    discover and use all available providers (TracerProvider, MeterProvider, etc.).

    Args:
        name: service name to report to OpenTelemetry (used as ``service.name``). Default is "kagent".
        namespace: logical namespace for the service (used as ``service.namespace``). Default is "kagent".
        fastapi_app: Optional FastAPI application instance to instrument. If
            provided and tracing is enabled, FastAPI routes will be instrumented.
            If metrics is enabled, a ``/metrics`` endpoint will be added for
            Prometheus scraping.
    """
    tracing_enabled = os.getenv("OTEL_TRACING_ENABLED", "false").lower() == "true"
    logging_enabled = os.getenv("OTEL_LOGGING_ENABLED", "false").lower() == "true"
    metrics_enabled = os.getenv("OTEL_METRICS_ENABLED", "false").lower() == "true"

    resource = Resource({"service.name": name, "service.namespace": namespace})

    # ------------------------------------------------------------------ #
    # 1. Configure providers BEFORE instrumentors so that instrumentors   #
    #    can discover MeterProvider, TracerProvider, etc. at init time.    #
    # ------------------------------------------------------------------ #

    # 1a. Metrics provider (Prometheus pull endpoint)
    if metrics_enabled:
        logging.info("Enabling Prometheus metrics")
        try:
            from opentelemetry.exporter.prometheus import PrometheusMetricReader
            from opentelemetry.sdk.metrics import MeterProvider

            reader = PrometheusMetricReader()
            meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
            metrics.set_meter_provider(meter_provider)
            logging.info("MeterProvider configured with Prometheus exporter")

            if fastapi_app:
                from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
                from starlette.responses import Response

                @fastapi_app.get("/metrics")
                async def metrics_endpoint():
                    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

                logging.info("Added /metrics endpoint for Prometheus scraping")
        except ImportError:
            logging.warning(
                "opentelemetry-exporter-prometheus is not installed; "
                "metrics endpoint will not be available. "
                "Install it with: pip install opentelemetry-exporter-prometheus"
            )

    # 1b. Tracing provider
    if tracing_enabled:
        logging.info("Enabling tracing")
        # Check standard OTEL env vars: signal-specific endpoint first, then general endpoint
        trace_endpoint = (
            os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
            or os.getenv("OTEL_TRACING_EXPORTER_OTLP_ENDPOINT")  # Backward compatibility
            or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        )
        trace_timeout_seconds = _resolve_otlp_timeout_seconds("TRACES")
        logging.info("Trace endpoint: %s", trace_endpoint or "<default>")
        if trace_endpoint:
            processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=trace_endpoint, timeout=trace_timeout_seconds))
        else:
            processor = BatchSpanProcessor(OTLPSpanExporter(timeout=trace_timeout_seconds))

        # Check if a TracerProvider already exists (e.g., set by CrewAI)
        current_provider = trace.get_tracer_provider()
        if isinstance(current_provider, TracerProvider):
            # TracerProvider already exists, just add our processors to it
            current_provider.add_span_processor(processor)
            current_provider.add_span_processor(KagentAttributesSpanProcessor())
            logging.info("Added OTLP processors to existing TracerProvider")
        else:
            # No provider set, create new one
            tracer_provider = TracerProvider(resource=resource)
            tracer_provider.add_span_processor(processor)
            tracer_provider.add_span_processor(KagentAttributesSpanProcessor())
            trace.set_tracer_provider(tracer_provider)
            logging.info("Created new TracerProvider")

    # 1c. Logging provider
    event_logger_provider = None
    if logging_enabled:
        logging.info("Enabling logging for GenAI events")
        logger_provider = LoggerProvider(resource=resource)
        # Check standard OTEL env vars: signal-specific endpoint first, then general endpoint
        log_endpoint = (
            os.getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT")
            or os.getenv("OTEL_LOGGING_EXPORTER_OTLP_ENDPOINT")  # Backward compatibility
            or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        )
        log_timeout_seconds = _resolve_otlp_timeout_seconds("LOGS")
        logging.info("Log endpoint: %s", log_endpoint or "<default>")

        # Add OTLP exporter
        if log_endpoint:
            log_processor = BatchLogRecordProcessor(OTLPLogExporter(endpoint=log_endpoint, timeout=log_timeout_seconds))
        else:
            log_processor = BatchLogRecordProcessor(OTLPLogExporter(timeout=log_timeout_seconds))
        logger_provider.add_log_record_processor(log_processor)

        _logs.set_logger_provider(logger_provider)
        logging.info("Log provider configured with OTLP")
        # Create event logger provider for instrumentors
        event_logger_provider = EventLoggerProvider(logger_provider)

    # ------------------------------------------------------------------ #
    # 2. Instrument libraries — all providers are now available.          #
    # ------------------------------------------------------------------ #

    if tracing_enabled:
        _excluded_urls = ".*/\\.well-known/agent-card\\.json"
        HTTPXClientInstrumentor().instrument(excluded_urls=_excluded_urls)
        if fastapi_app:
            FastAPIInstrumentor().instrument_app(fastapi_app, excluded_urls=_excluded_urls)

    if event_logger_provider:
        # Event logging mode: input/output as log events in Body
        logging.info("OpenAI instrumentation configured with event logging capability")
        OpenAIInstrumentor(use_legacy_attributes=False).instrument(event_logger_provider=event_logger_provider)
        _instrument_anthropic(event_logger_provider)
    else:
        # Legacy attributes mode: input/output as GenAI span attributes
        logging.info("OpenAI instrumentation configured with legacy GenAI span attributes")
        OpenAIInstrumentor().instrument()
        _instrument_anthropic()
        _instrument_google_generativeai()
