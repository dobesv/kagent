import { useMemo, useState } from "react";
import { FunctionCall } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { convertToUserFriendlyName } from "@/lib/utils";
import { ChevronUp, ChevronDown, MessageSquare, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import KagentLogo from "../kagent-logo";
import { SmartContent, parseContentString } from "./SmartContent";

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
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="block w-full text-left cursor-pointer rounded-md hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-start gap-1.5">
          <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="relative max-h-20 overflow-hidden">
              {previewContent}
            </div>
          </div>
        </div>
        <div className="flex justify-center pt-0.5 text-muted-foreground">
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-md">
      <div className="flex items-start gap-1.5">
        <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className={`relative rounded-md ${errorStyle ? "bg-red-50 dark:bg-red-950/10" : ""}`}>
            <ScrollArea className="max-h-96 overflow-y-auto p-2 w-full rounded-md bg-muted/50">
              {expandedContent}
            </ScrollArea>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="flex justify-center w-full pt-0.5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
    </div>
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

  const parsedResult = hasResult && result?.content ? parseContentString(result.content) : null;
  const argsContent = <SmartContent data={call.args} />;
  const resultContent = parsedResult !== null
    ? <SmartContent data={parsedResult} className={isError ? "text-red-600 dark:text-red-400" : ""} />
    : null;

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
          previewContent={argsContent}
          expandedContent={argsContent}
        />
        {status === "executing" && !hasResult && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{agentDisplay} is responding...</span>
          </div>
        )}
        {hasResult && resultContent && (
          <CollapsibleSection
            icon={MessageSquare}
            expanded={areResultsExpanded}
            onToggle={() => setAreResultsExpanded(!areResultsExpanded)}
            previewContent={resultContent}
            expandedContent={resultContent}
            errorStyle={isError}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default AgentCallDisplay;


