"use client";

import React, { useState, useEffect, CSSProperties } from "react";
import AgentList from "@/components/AgentList";
import AllSessionsSidebar from "@/components/sidebars/AllSessionsSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getAllSessions } from "@/app/actions/sessions";
import type { Session } from "@/types";

export default function HomeContent() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await getAllSessions();
        if (!response.error && response.data) {
          setSessions(response.data);
        }
      } catch (error) {
        console.error("Failed to load sessions:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSessions();
  }, []);

  const hasSessions = !isLoading && sessions.length > 0;

  if (!hasSessions) {
    return <AgentList />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "350px",
          "--sidebar-width-mobile": "150px",
        } as CSSProperties
      }
    >
      <AllSessionsSidebar sessions={sessions} />
      <div className="flex-1 overflow-y-auto">
        <AgentList />
      </div>
    </SidebarProvider>
  );
}
