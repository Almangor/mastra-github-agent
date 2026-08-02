import { z } from 'zod';

import type { ToolDescriptor } from '@ceo/contracts';
import { defineBusinessTool, type ToolRuntime } from '@ceo/platform-mastra';

/**
 * @ceo/integrations-google — calendar and documents.
 *
 * Calendar reads drive meeting prep; the calendar *write* is tier-2 because a hold
 * on the CEO's calendar is visible to other people the moment it lands.
 *
 * Without `GOOGLE_SERVICE_ACCOUNT_JSON` the adapter reports itself disabled rather
 * than fabricating a schedule — a made-up meeting is worse than a missing one.
 */

const DISABLED = {
  status: 'integration_disabled' as const,
  message:
    'Google Workspace is not configured. Tell the user the calendar could not be read rather than guessing at their schedule.',
};

function enabled(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function googleTools(getRuntime: () => ToolRuntime) {
  const listCalendarEvents = defineBusinessTool(
    {
      descriptor: {
        id: 'google.listCalendarEvents',
        tier: 'tier0_read',
        summary: 'Read calendar events',
        system: 'google-calendar',
        reversible: true,
        allowedSurfaces: ['dm', 'scheduled', 'admin_cli'],
      },
      description:
        "List calendar events in a window. Use for meeting preparation and to understand where the CEO's time is going.",
      inputSchema: z.object({
        from: z.string().datetime().describe('ISO 8601 start of window'),
        to: z.string().datetime().describe('ISO 8601 end of window'),
        calendarId: z.string().default('primary'),
      }),
      renderSummary: a => `Read calendar ${a.calendarId} from ${a.from} to ${a.to}`,
      execute: async () => {
        if (!enabled()) return DISABLED;
        // A real implementation exchanges the service-account JWT for an access
        // token and calls calendar/v3/events. Left unimplemented deliberately:
        // shipping an untested OAuth path would be worse than an explicit gap.
        throw new Error('google.listCalendarEvents: OAuth exchange not implemented (see ADR-0006)');
      },
    },
    getRuntime,
  );

  const createCalendarHold = defineBusinessTool(
    {
      descriptor: {
        id: 'google.createCalendarHold',
        tier: 'tier2_business_write',
        summary: 'Create a calendar hold',
        system: 'google-calendar',
        reversible: true,
        allowedSurfaces: ['dm', 'scheduled'],
      },
      description:
        'Place a hold on the calendar. Gated: this will be sent for approval because it is visible to other attendees.',
      inputSchema: z.object({
        title: z.string().min(1),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        attendees: z.array(z.string().email()).default([]),
      }),
      renderSummary: a =>
        `Hold "${a.title}" ${a.startsAt}–${a.endsAt}${a.attendees.length ? ` with ${a.attendees.length} attendee(s)` : ''}`,
      execute: async () => {
        if (!enabled()) return DISABLED;
        throw new Error('google.createCalendarHold: OAuth exchange not implemented (see ADR-0006)');
      },
    },
    getRuntime,
  );

  return { listCalendarEvents, createCalendarHold };
}

export const GOOGLE_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    id: 'google.listCalendarEvents',
    tier: 'tier0_read',
    summary: 'Read calendar events',
    system: 'google-calendar',
    reversible: true,
    allowedSurfaces: ['dm', 'scheduled', 'admin_cli'],
  },
  {
    id: 'google.createCalendarHold',
    tier: 'tier2_business_write',
    summary: 'Create a calendar hold',
    system: 'google-calendar',
    reversible: true,
    allowedSurfaces: ['dm', 'scheduled'],
  },
];
