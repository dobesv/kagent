import { useMemo, useState } from "react";
import { FunctionCall } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { convertToUserFriendlyName } from "@/lib/utils";
import { ChevronRight, ChevronDown, MessageSquare, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import KagentLogo from "../kagent-logo";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import rehypeExternalLinks from "rehype-external-links";
import CodeBlock from "./CodeBlock";

export type AgentCallStatus = "requested" | "executing" | "completed";

interface AgentCallDisplayProps {
  call: FunctionCall;
  result?: {
    content: string;
    is_error?: boolean;
  };
  status?: AgentCallStatus;
  isError?: boolean;
}

const AGENT_TOOL_NAME_RE = /^(.+)__NS__(.+)$/;

// ── Markdown components (mirrors TruncatableText pattern) ──────────────────
const markdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: (props: any) => {
    const { children, className } = props;
    if (className) {
      return <CodeBlock className={className}>{[children]}</CodeBlock>;
    }
    return <code className={className}>{children}</code>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: (props: any) => {
    const { children } = props;
    return <table className="min-w-full divide-y divide-gray-300 table-fixed">{children}</table>;
  },
};

function isMarkdownRenderable(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 1 && typeof (parsed as Record<string, unknown>)[keys[0]] === "string") return true;
    }
    return false;
  } catch {
    return true;
  }
}

function extractMarkdownContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 1) {
        const val = (parsed as Record<string, unknown>)[keys[0]];
        if (typeof val === "string") return val;
      }
    }
  } catch { /* not JSON */ }
  return trimmed;
}

function isArgsMarkdownRenderable(args: Record<string, unknown>): boolean {
  const keys = Object.keys(args);
  return keys.length === 1 && typeof args[keys[0]] === "string";
}

function extractArgsMarkdownContent(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  return args[keys[0]] as string;
}

function MarkdownBlock({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`prose-md prose max-w-none dark:prose-invert text-sm ${className ?? ""}`}>
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[gfm]}
        rehypePlugins={[[rehypeExternalLinks, { target: "_blank" }]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CollapsibleSection({
  icon: Icon,
  expanded,
  onToggle,
  previewContent,
  expandedContent,
  errorStyle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  expanded: boolean;
  onToggle: () => void;
  previewContent: React.ReactNode;
  expandedContent: React.ReactNode;
  errorStyle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-start gap-1.5 w-full text-left cursor-pointer rounded-md hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-center gap-1 pt-0.5 shrink-0 text-muted-foreground">
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        {!expanded && (
          <div className="relative max-h-20 overflow-hidden">
            {previewContent}
            <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          </div>
        )}
        {expanded && (
          <div className={`relative rounded-md ${errorStyle ? "bg-red-50 dark:bg-red-950/10" : ""}`}>
            <ScrollArea className="max-h-96 overflow-y-auto p-2 w-full rounded-md bg-muted/50">
              {expandedContent}
            </ScrollArea>
          </div>
        )}
      </div>
    </button>
  );
}

const AgentCallDisplay = ({ call, result, status = "requested", isError = false }: AgentCallDisplayProps) => {
  const [areInputsExpanded, setAreInputsExpanded] = useState(false);
  const [areResultsExpanded, setAreResultsExpanded] = useState(false);

  const agentDisplay = useMemo(() => convertToUserFriendlyName(call.name), [call.name]);
  const hasResult = result !== undefined;

  const getStatusDisplay = () => {
    if (isError && status === "executing") {
      return (
        <>
          <AlertCircle className="w-3 h-3 inline-block mr-2 text-red-500" />
          Error
        </>
      );
    }
    switch (status) {
      case "requested":
        return (
          <>
            <KagentLogo className="w-3 h-3 inline-block mr-2 text-blue-500" />
            Delegating
          </>
        );
      case "executing":
        return (
          <>
            <Loader2 className="w-3 h-3 inline-block mr-2 text-yellow-500 animate-spin" />
            Awaiting response
          </>
        );
      case "completed":
        if (isError) {
          return (
            <>
              <AlertCircle className="w-3 h-3 inline-block mr-2 text-red-500" />
              Failed
            </>
          );
        }
        return (
          <>
            <CheckCircle className="w-3 h-3 inline-block mr-2 text-green-500" />
            Completed
          </>
        );
      default:
        return null;
    }
  };

  // ── Input rendering ──────────────────────────────────────────────────
  const argsIsMarkdown = isArgsMarkdownRenderable(call.args);
  const argsMarkdown = argsIsMarkdown ? extractArgsMarkdownContent(call.args) : "";
  const argsJson = JSON.stringify(call.args, null, 2);

  const renderArgsContent = () => {
    if (argsIsMarkdown) {
      return <MarkdownBlock content={argsMarkdown} />;
    }
    return <pre className="text-sm whitespace-pre-wrap break-words">{argsJson}</pre>;
  };

  // ── Output rendering ────────────────────────────────────────────────
  const resultContent = result?.content ?? "";
  const resultIsMarkdown = resultContent ? isMarkdownRenderable(resultContent) : false;
  const resultMarkdown = resultIsMarkdown ? extractMarkdownContent(resultContent) : "";

  const renderResultContent = () => {
    const errorClass = isError ? "text-red-600 dark:text-red-400" : "";
    if (resultIsMarkdown) {
      return <MarkdownBlock content={resultMarkdown} className={errorClass} />;
    }

    let formatted = resultContent;
    try {
      const parsed = JSON.parse(resultContent);
      formatted = JSON.stringify(parsed, null, 2);
    } catch { /* keep as-is */ }

    return (
      <pre className={`text-sm whitespace-pre-wrap break-words ${errorClass}`}>
        {formatted}
      </pre>
    );
  };

  return (
    <Card className={`w-full mx-auto my-1 min-w-full ${isError ? 'border-red-300' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs flex space-x-5">
          <div className="flex items-center font-medium">
            <KagentLogo className="w-4 h-4 mr-2" />
            {agentDisplay}
          </div>
          <div className="font-light">{call.id}</div>
        </CardTitle>
        <div className="flex justify-center items-center text-xs">
          {getStatusDisplay()}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <CollapsibleSection
          icon={MessageSquare}
          expanded={areInputsExpanded}
          onToggle={() => setAreInputsExpanded(!areInputsExpanded)}
          previewContent={renderArgsContent()}
          expandedContent={renderArgsContent()}
        />
        {status === "executing" && !hasResult && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{agentDisplay} is responding...</span>
          </div>
        )}
        {hasResult && result?.content && (
          <CollapsibleSection
            icon={MessageSquare}
            expanded={areResultsExpanded}
            onToggle={() => setAreResultsExpanded(!areResultsExpanded)}
            previewContent={renderResultContent()}
            expandedContent={renderResultContent()}
            errorStyle={isError}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default AgentCallDisplay;


