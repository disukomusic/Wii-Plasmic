
// lib/agentUtils.ts
import type { BskyAgent } from "@atproto/api";

/**
 * Return the agent if it has an authenticated session (did present), else null.
 * Works for:
 *  - dev: BskyAgent.login() or resumeSession()
 *  - prod: OAuth Agent(session)
 */
export function getActiveAgentOrNull(agent: BskyAgent | null | undefined): BskyAgent | null {
    if (!agent) return null;
    return agent.session?.did ? agent : null;
}
