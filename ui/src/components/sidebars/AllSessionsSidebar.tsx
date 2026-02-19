"use client";

import React, { useMemo, useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuSub,
} from "../ui/sidebar";
import { ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { isToday, isYesterday } from "date-fns";
import type { Session } from "@/types";
import { deleteSession, getSessionTasks } from "@/app/actions/sessions";
import { convertToUserFriendlyName } from "@/lib/utils";
import ChatItem from "./ChatItem";
import { Collapsible } from "@radix-ui/react-collapsible";
import { CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { toast } from "sonner";

function resolveAgentRef(agentId: string | number | undefined): { namespace: string; name: string } | null {
  if (!agentId) return null;
  const friendly = convertToUserFriendlyName(String(agentId));
  const slashIndex = friendly.indexOf("/");
  if (slashIndex === -1) return null;
  return {
    namespace: friendly.substring(0, slashIndex),
    name: friendly.substring(slashIndex + 1),
  };
}

interface AllSessionsSidebarProps {
  sessions: Session[];
  isLoading?: boolean;
}

export default function AllSessionsSidebar({ sessions: initialSessions, isLoading = false }: AllSessionsSidebarProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);

  useEffect(() => {
    setSessions(initialSessions);
  }, [initialSessions]);

  const groupedChats = useMemo(() => {
    const groups: { today: Session[]; yesterday: Session[]; older: Session[] } = {
      today: [],
      yesterday: [],
      older: [],
    };

    sessions.forEach((session) => {
      const date = new Date(session.created_at);
      if (isToday(date)) groups.today.push(session);
      else if (isYesterday(date)) groups.yesterday.push(session);
      else groups.older.push(session);
    });

    const sortByDate = (list: Session[]) =>
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      today: sortByDate(groups.today),
      yesterday: sortByDate(groups.yesterday),
      older: sortByDate(groups.older),
    };
  }, [sessions]);

  const handleDelete = async (sessionId: string) => {
    try {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      await deleteSession(sessionId);
    } catch (error) {
      console.error("Error deleting session:", error);
      setSessions(initialSessions);
    }
  };

  const handleDownload = async (sessionId: string) => {
    toast.promise(
      getSessionTasks(String(sessionId)).then((messages) => {
        const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${sessionId}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return messages;
      }),
      {
        loading: "Downloading session...",
        success: "Session downloaded successfully",
        error: "Failed to download session",
      }
    );
  };

  const renderGroup = (title: string, groupSessions: Session[]) => {
    if (groupSessions.length === 0) return null;
    return (
      <SidebarGroup key={title}>
        <SidebarMenu>
          <Collapsible defaultOpen={title.toLowerCase() === "today"} className="group/collapsible w-full">
            <div className="w-full">
              <CollapsibleTrigger className="flex items-center justify-between w-full rounded-md p-2 pr-[9px] text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <span>{title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <SidebarMenuSub className="mx-0 px-0 ml-2 pl-2">
                {groupSessions.map((session) => {
                  const ref = resolveAgentRef(session.agent_id);
                  return (
                    <ChatItem
                      key={session.id}
                      sessionId={session.id}
                      agentName={ref?.name}
                      agentNamespace={ref?.namespace}
                      onDelete={handleDelete}
                      sessionName={session.name}
                      onDownload={handleDownload}
                      createdAt={session.created_at}
                      showAgentName
                    />
                  );
                })}
              </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar side="left" collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <MessageSquare className="h-5 w-5" />
          <span className="font-semibold text-sm">Recent Chats</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="flex-1 my-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading sessions...</span>
            </div>
          ) : (
            <>
              {renderGroup("Today", groupedChats.today)}
              {renderGroup("Yesterday", groupedChats.yesterday)}
              {renderGroup("Older", groupedChats.older)}
            </>
          )}
        </ScrollArea>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
