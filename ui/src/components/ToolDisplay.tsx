import { useState } from "react";
import { FunctionCall } from "@/types";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import { FunctionSquare, CheckCircle, Clock, Code, ChevronRight, ChevronDown, Loader2, Text, Check, Copy, AlertCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import rehypeExternalLinks from "rehype-external-links";
import CodeBlock from "@/components/chat/CodeBlock";

export type ToolCallStatus = "requested" | "executing" | "completed" | "pending_approval" | "approved" | "rejected";

interface ToolDisplayProps {
  call: FunctionCall;
  result?: {
    content: string;
    is_error?: boolean;
  };
  status?: ToolCallStatus;
  isError?: boolean;
  /** When true, the card is in a "decided but not yet submitted" state (batch flow). */
  isDecided?: boolean;
  onApprove?: () => void;
  onReject?: (reason?: string) => void;
}

// ── Markdown components (mirrors TruncatableText pattern) ──────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/**
 * Returns true when a string should be rendered as markdown rather than
 * formatted JSON in a `<pre>` block.
 *
 * - Plain text (not valid JSON) → true
 * - JSON object with exactly ONE key whose value is a string → true
 * - Everything else (arrays, multi-key objects, nested) → false
 */
function isMarkdownRenderable(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return true;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 1 && typeof (parsed as Record<string, unknown>)[keys[0]] === "string") {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Extracts the string to feed to ReactMarkdown.
 * - Plain text → as-is
 * - Single-field JSON object → the string value
 */
function extractMarkdownContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 1) {
        const val = (parsed as Record<string, unknown>)[keys[0]];
        if (typeof val === "string") return val;
      }
    }
  } catch {
    // not JSON
  }
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

// ── Markdown renderer ──────────────────────────────────────────────────────
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
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>;
  expanded: boolean;
  onToggle: () => void;
  previewContent: React.ReactNode;
  expandedContent: React.ReactNode;
  errorStyle?: boolean;
  actions?: React.ReactNode;
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
            {actions && <div className="absolute top-1 right-1">{actions}</div>}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
const ToolDisplay = ({ call, result, status = "requested", isError = false, isDecided = false, onApprove, onReject }: ToolDisplayProps) => {
  const [areArgumentsExpanded, setAreArgumentsExpanded] = useState(status === "pending_approval");
  const [areResultsExpanded, setAreResultsExpanded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const hasResult = result !== undefined;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result?.content || "");
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  const handleApprove = async () => {
    if (!onApprove) {
      return;
    }
    setIsSubmitting(true);
    onApprove();
  };

  /** Show the rejection reason form instead of immediately rejecting. */
  const handleRejectClick = () => {
    setShowRejectForm(true);
  };

  /** Confirm rejection — submits with optional reason. */
  const handleRejectConfirm = async () => {
    if (!onReject) {
      return;
    }
    setShowRejectForm(false);
    setIsSubmitting(true);
    onReject(rejectionReason.trim() || undefined);
  };

  /** Cancel the rejection form — go back to Approve/Reject buttons. */
  const handleRejectCancel = () => {
    setShowRejectForm(false);
    setRejectionReason("");
  };

  // Define UI elements based on status
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
            <Clock className="w-3 h-3 inline-block mr-2 text-blue-500" />
            Call requested
          </>
        );
      case "pending_approval":
        return (
          <>
            <ShieldAlert className="w-3 h-3 inline-block mr-2 text-amber-500" />
            Approval required
          </>
        );
      case "approved":
        return (
          <>
            <CheckCircle className="w-3 h-3 inline-block mr-2 text-green-500" />
            Approved
          </>
        );
      case "rejected":
        return (
          <>
            <AlertCircle className="w-3 h-3 inline-block mr-2 text-red-500" />
            Rejected
          </>
        );
      case "executing":
        return (
          <>
            <Loader2 className="w-3 h-3 inline-block mr-2 text-yellow-500 animate-spin" />
            Executing
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

  const borderClass = status === "pending_approval"
    ? 'border-amber-300 dark:border-amber-700'
    : status === "rejected"
      ? 'border-red-300 dark:border-red-700'
      : status === "approved"
        ? 'border-green-300 dark:border-green-700'
        : isError
          ? 'border-red-300'
          : '';

  // ── Arguments rendering ────────────────────────────────────────────────
  const argsIsMarkdown = isArgsMarkdownRenderable(call.args);
  const argsMarkdown = argsIsMarkdown ? extractArgsMarkdownContent(call.args) : "";
  const argsJson = JSON.stringify(call.args, null, 2);

  const renderArgsContent = () => {
    if (argsIsMarkdown) {
      return <MarkdownBlock content={argsMarkdown} />;
    }
    return <pre className="text-sm whitespace-pre-wrap break-words">{argsJson}</pre>;
  };

  // ── Results rendering ──────────────────────────────────────────────────
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
    } catch {
      // keep as-is
    }

    return (
      <pre className={`text-sm whitespace-pre-wrap break-words ${errorClass}`}>
        {formatted}
      </pre>
    );
  };

  return (
    <Card className={`w-full mx-auto my-1 min-w-full ${borderClass}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs flex space-x-5">
          <div className="flex items-center font-medium">
            <FunctionSquare className="w-4 h-4 mr-2" />
            {call.name}
          </div>
          <div className="font-light">{call.id}</div>
        </CardTitle>
        <div className="flex justify-center items-center text-xs">
          {getStatusDisplay()}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
          <div className="space-y-2 mt-4">
        <CollapsibleSection
          icon={Code}
          expanded={areArgumentsExpanded}
          onToggle={() => setAreArgumentsExpanded(!areArgumentsExpanded)}
          previewContent={renderArgsContent()}
          expandedContent={renderArgsContent()}
        />
          </div>


          {/* Approval buttons — hidden when decided (batch) or submitting */}
          {status === "pending_approval" && !isSubmitting && !isDecided && !showRejectForm && (
              <div className="mt-4 space-y-2">
                  <div className="flex gap-2">
                      <Button
                          size="sm"
                          variant="default"
                          onClick={handleApprove}
                      >
                          Approve
                      </Button>
                      <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleRejectClick}
                      >
                          Reject
                      </Button>
                  </div>
              </div>
          )}

          {/* Rejection reason form — shown after clicking Reject */}
          {status === "pending_approval" && !isSubmitting && !isDecided && showRejectForm && (
              <div className="mt-4 space-y-2">
                  <Textarea
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Why are you rejecting this? (optional)"
                      className="min-h-[60px] resize-none text-sm"
                      autoFocus
                  />
                  <div className="flex gap-2">
                      <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleRejectConfirm}
                      >
                          Reject
                      </Button>
                      <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRejectCancel}
                      >
                          Cancel
                      </Button>
                  </div>
              </div>
          )}

          {status === "pending_approval" && (isSubmitting || isDecided) && (
              <div className="flex items-center gap-2 py-2 mt-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">
              {isDecided ? "Waiting..." : "Submitting decision..."}
            </span>
              </div>
          )}
      <div className="mt-4 w-full">
          {status === "executing" && !hasResult && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Executing...</span>
          </div>
        )}
        {hasResult && (
          <CollapsibleSection
            icon={Text}
            expanded={areResultsExpanded}
            onToggle={() => setAreResultsExpanded(!areResultsExpanded)}
            previewContent={renderResultContent()}
            expandedContent={renderResultContent()}
            errorStyle={isError}
            actions={
              <Button variant="ghost" size="sm" className="p-2" onClick={handleCopy}>
                {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
};

export default ToolDisplay;
