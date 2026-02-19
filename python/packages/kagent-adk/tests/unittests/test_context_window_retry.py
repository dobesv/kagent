import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from kagent.adk._agent_executor import (
    _is_context_window_error,
    A2aAgentExecutor,
    _DEFAULT_EVENT_RETENTION_SIZE,
)


class ContextWindowExceededError(Exception):
    pass


class TestIsContextWindowError:
    def test_litellm_context_window_exceeded_error(self):
        error = ContextWindowExceededError("context window exceeded")
        assert _is_context_window_error(error) is True

    def test_anthropic_prompt_too_long_error(self):
        error = Exception("Error: prompt is too long for the model")
        assert _is_context_window_error(error) is True

    def test_openai_maximum_context_length_error(self):
        error = Exception("Error: maximum context length exceeded")
        assert _is_context_window_error(error) is True

    def test_generic_context_window_error(self):
        error = Exception("The context window is too large")
        assert _is_context_window_error(error) is True

    def test_context_length_exceeded_error(self):
        error = Exception("context_length_exceeded: too many tokens")
        assert _is_context_window_error(error) is True

    def test_non_context_window_error(self):
        error = Exception("Some other error occurred")
        assert _is_context_window_error(error) is False

    def test_empty_error_message(self):
        error = Exception("")
        assert _is_context_window_error(error) is False

    def test_case_insensitive_matching(self):
        error = Exception("PROMPT IS TOO LONG")
        assert _is_context_window_error(error) is True

    def test_context_window_in_error_message(self):
        error = Exception("Request failed: context window limit reached")
        assert _is_context_window_error(error) is True


def _make_mock_compaction_config(**overrides):
    config = MagicMock()
    config.compaction_interval = overrides.get("compaction_interval", 5)
    config.overlap_size = overrides.get("overlap_size", 2)
    config.event_retention_size = overrides.get("event_retention_size", 10)
    config.summarizer = overrides.get("summarizer", None)
    return config


class TestTryCompactContext:
    @pytest.mark.asyncio
    async def test_compact_context_succeeds(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = [MagicMock(), MagicMock()]

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = _make_mock_compaction_config()

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        with patch(
            "google.adk.apps.compaction._run_compaction_for_token_threshold", new_callable=AsyncMock
        ) as mock_compaction:
            mock_compaction.return_value = True

            result = await executor._try_compact_context(mock_runner, run_args)

            assert result is True
            mock_compaction.assert_called_once()

    @pytest.mark.asyncio
    async def test_compact_context_skips_when_no_compaction_configured(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_runner = AsyncMock()
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = None

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        result = await executor._try_compact_context(mock_runner, run_args)

        assert result is False
        mock_runner.session_service.get_session.assert_not_called()

    @pytest.mark.asyncio
    async def test_compact_context_session_not_found(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=None)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = _make_mock_compaction_config()

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        result = await executor._try_compact_context(mock_runner, run_args)

        assert result is False

    @pytest.mark.asyncio
    async def test_compact_context_session_has_no_events(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = []

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = _make_mock_compaction_config()

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        result = await executor._try_compact_context(mock_runner, run_args)

        assert result is False

    @pytest.mark.asyncio
    async def test_compact_context_compaction_fails(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = [MagicMock()]

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = _make_mock_compaction_config()

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        with patch(
            "google.adk.apps.compaction._run_compaction_for_token_threshold", new_callable=AsyncMock
        ) as mock_compaction:
            mock_compaction.return_value = False

            result = await executor._try_compact_context(mock_runner, run_args)

            assert result is False

    @pytest.mark.asyncio
    async def test_compact_context_exception_handling(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_runner = AsyncMock()
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = _make_mock_compaction_config()
        mock_runner.session_service.get_session = AsyncMock(side_effect=Exception("Database error"))
        mock_runner.app_name = "test_app"

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        result = await executor._try_compact_context(mock_runner, run_args)

        assert result is False

    @pytest.mark.asyncio
    async def test_compact_context_preserves_original_config(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = [MagicMock()]

        original_config = _make_mock_compaction_config(event_retention_size=20, summarizer=MagicMock())

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = original_config

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        with patch(
            "google.adk.apps.compaction._run_compaction_for_token_threshold", new_callable=AsyncMock
        ) as mock_compaction:
            mock_compaction.return_value = True

            await executor._try_compact_context(mock_runner, run_args)

            assert mock_runner.app.events_compaction_config == original_config

    @pytest.mark.asyncio
    async def test_compact_context_uses_existing_event_retention_size(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = [MagicMock()]

        original_config = _make_mock_compaction_config(event_retention_size=25)

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = original_config

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        with patch(
            "google.adk.apps.compaction._run_compaction_for_token_threshold", new_callable=AsyncMock
        ) as mock_compaction:
            with patch("google.adk.apps.app.EventsCompactionConfig") as mock_config_class:
                mock_compaction.return_value = True

                await executor._try_compact_context(mock_runner, run_args)

                call_args = mock_config_class.call_args
                assert call_args[1]["event_retention_size"] == 25

    @pytest.mark.asyncio
    async def test_compact_context_uses_default_retention_size_when_none_in_config(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = [MagicMock()]

        original_config = _make_mock_compaction_config(event_retention_size=None)

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = original_config

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        with patch(
            "google.adk.apps.compaction._run_compaction_for_token_threshold", new_callable=AsyncMock
        ) as mock_compaction:
            with patch("google.adk.apps.app.EventsCompactionConfig") as mock_config_class:
                mock_compaction.return_value = True

                await executor._try_compact_context(mock_runner, run_args)

                call_args = mock_config_class.call_args
                assert call_args[1]["event_retention_size"] == _DEFAULT_EVENT_RETENTION_SIZE

    @pytest.mark.asyncio
    async def test_compact_context_restores_config_on_exception(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_session = MagicMock()
        mock_session.events = [MagicMock()]

        original_config = _make_mock_compaction_config(event_retention_size=15)

        mock_runner = AsyncMock()
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.app_name = "test_app"
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = original_config

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
        }

        with patch(
            "google.adk.apps.compaction._run_compaction_for_token_threshold", new_callable=AsyncMock
        ) as mock_compaction:
            mock_compaction.side_effect = Exception("Compaction failed")

            await executor._try_compact_context(mock_runner, run_args)

            assert mock_runner.app.events_compaction_config == original_config


class TestHandleRequestRetryFlow:
    @pytest.mark.asyncio
    async def test_handle_request_retries_on_context_window_error(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_context = MagicMock()
        mock_context.task_id = "task123"
        mock_context.context_id = "context123"
        mock_context.message = MagicMock()
        mock_context.message.parts = []
        mock_context.current_task = None
        mock_context.call_context.state = {"headers": {}}

        mock_event_queue = AsyncMock()

        mock_session = MagicMock()
        mock_session.id = "session123"
        mock_session.events = [MagicMock()]

        mock_runner = AsyncMock()
        mock_runner.app_name = "test_app"
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.session_service.append_event = AsyncMock()
        mock_runner._new_invocation_context = MagicMock()
        mock_runner.app = MagicMock()
        mock_runner.app.events_compaction_config = None

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
            "new_message": MagicMock(),
            "run_config": MagicMock(),
        }

        context_window_error = Exception("maximum context length exceeded")

        async def error_gen():
            raise context_window_error
            yield

        mock_runner.run_async = MagicMock(return_value=error_gen())

        with patch.object(executor, "_try_compact_context", new_callable=AsyncMock) as mock_compact:
            mock_compact.return_value = False

            with pytest.raises(Exception) as exc_info:
                await executor._handle_request(mock_context, mock_event_queue, mock_runner, run_args)

            assert "maximum context length exceeded" in str(exc_info.value)
            mock_compact.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_request_does_not_retry_non_context_window_error(self):
        executor = A2aAgentExecutor(runner=MagicMock())

        mock_context = MagicMock()
        mock_context.task_id = "task123"
        mock_context.context_id = "context123"
        mock_context.message = MagicMock()
        mock_context.message.parts = []
        mock_context.current_task = None
        mock_context.call_context.state = {"headers": {}}

        mock_event_queue = AsyncMock()

        mock_session = MagicMock()
        mock_session.id = "session123"
        mock_session.events = []

        mock_runner = AsyncMock()
        mock_runner.app_name = "test_app"
        mock_runner.session_service.get_session = AsyncMock(return_value=mock_session)
        mock_runner.session_service.append_event = AsyncMock()
        mock_runner._new_invocation_context = MagicMock()

        run_args = {
            "user_id": "user123",
            "session_id": "session123",
            "new_message": MagicMock(),
            "run_config": MagicMock(),
        }

        other_error = Exception("Some other error")

        async def error_gen():
            raise other_error
            yield

        mock_runner.run_async = MagicMock(return_value=error_gen())

        with patch.object(executor, "_try_compact_context", new_callable=AsyncMock) as mock_compact:
            with pytest.raises(Exception) as exc_info:
                await executor._handle_request(mock_context, mock_event_queue, mock_runner, run_args)

            assert "Some other error" in str(exc_info.value)
            mock_compact.assert_not_called()
