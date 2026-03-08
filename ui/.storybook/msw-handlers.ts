import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('*/sessions/:sessionId/subagentsessions/:toolCallId', ({ params }) => {
    const { sessionId, toolCallId } = params
    return HttpResponse.json({
      message: 'Sub-agent session fetched successfully',
      data: {
        session: {
          id: `sub-session-${toolCallId}`,
          agent_id: 'default/sub-agent',
          name: 'Sub-agent session name',
          user_id: 'admin@kagent.dev',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      }
    })
  }),
]
