
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { BskyAgent, AtpSessionData, AtpSessionEvent } from "@atproto/api";

/**
 * Shape of the authentication/session context exposed to the app.
 *
 * - `agent` is the shared ATProto client used for all API calls.
 * - `isLoggedIn` reflects whether we have an active session + user loaded.
 * - `currentUser` holds the logged-in user's profile (or null when logged out).
 * - `login/logout` perform authentication actions and update state accordingly.
 */
type BlueskySessionCtx = {
    agent: BskyAgent;
    isLoggedIn: boolean;
    currentUser: any | null;
    login: (identifier: string, appPassword: string) => Promise<void>;
    logout: () => Promise<void>;
};

/**
 * React context for Bluesky auth/session state.
 * Initialized as null so we can safely detect "not wrapped in provider".
 */
const BlueskyCtx = createContext<BlueskySessionCtx | null>(null);

/**
 * Provider responsible for:
 * - Creating a single BskyAgent instance (memoized)
 * - Persisting sessions in localStorage
 * - Resuming the session on initial mount
 * - Exposing login/logout utilities to the rest of the app
 *
 * Note: This is a client component because it uses localStorage + browser APIs.
 */
export function BlueskyAuthProvider({ children }: { children: React.ReactNode }) {
    /**
     * Create one agent instance for the lifetime of the provider.
     * `persistSession` is called by the agent whenever a session is created,
     * refreshed, or cleared, letting us keep localStorage in sync.
     */
    const agent = useMemo(
        () =>
            new BskyAgent({
                service: "https://bsky.social",
                // Persist session on create/refresh/clear so it's seamless across pages
                persistSession: (evt: AtpSessionEvent, sess?: AtpSessionData) => {
                    if (evt === "create" || evt === "refresh") {
                        localStorage.setItem("bsky_session", JSON.stringify(sess));
                    } else if (evt === "clear") {
                        localStorage.removeItem("bsky_session");
                    }
                },
            }),
        []
    );

    /** Minimal auth state exposed to UI */
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    /** Cached profile of the currently authenticated user */
    const [currentUser, setCurrentUser] = useState<any | null>(null);

    /**
     * One-time session resume on initial mount.
     * If a session exists in localStorage, we restore it into the agent and then
     * fetch the user's profile for display/bindings.
     *
     * Failure handling:
     * - If resume fails (expired/invalid session), we clear localStorage so we don't
     *   keep retrying a broken session.
     */
    useEffect(() => {
        (async () => {
            // If the agent already has a session, no need to resume.
            if (agent.hasSession) return;

            const saved = localStorage.getItem("bsky_session");
            if (!saved) return;

            try {
                const data = JSON.parse(saved);

                // Restores session tokens into the agent (so future API calls are authed).
                await agent.resumeSession(data);

                // Load profile so UI can show avatar/displayName/etc.
                const profile = await agent.getProfile({ actor: data.did });

                setCurrentUser(profile.data);
                setIsLoggedIn(true);
            } catch {
                // If anything goes wrong, remove the stored session and start fresh.
                localStorage.removeItem("bsky_session");
            }
        })();
    }, [agent]);

    /**
     * Login with identifier + app password (Bluesky's recommended auth style).
     * On success:
     * - agent stores the session
     * - persistSession writes it to localStorage
     * - we fetch the profile and update state
     */
    const login = async (identifier: string, appPassword: string) => {
        const res = await agent.login({ identifier, password: appPassword });
        const profile = await agent.getProfile({ actor: res.data.did });
        setCurrentUser(profile.data);
        setIsLoggedIn(true);
    };

    /**
     * Logout:
     * - clears agent session (triggers persistSession "clear")
     * - resets local UI state
     */
    const logout = async () => {
        await agent.logout();
        setIsLoggedIn(false);
        setCurrentUser(null);
    };

    return (
        <BlueskyCtx.Provider value={{ agent, isLoggedIn, currentUser, login, logout }}>
            {children}
        </BlueskyCtx.Provider>
    );
}

/**
 * Hook to consume the Bluesky auth/session context.
 *
 * Special behavior:
 * - If used outside the provider (or during odd render phases), returns a
 *   "null-safe" fallback instead of throwing.
 *
 * This is handy when integrating with systems that may render before the provider
 * is mounted (or when you want the UI to be resilient rather than crash).
 */
export function useBluesky() {
    const ctx = useContext(BlueskyCtx);

    // If there is no context (like during pre-rendering),
    // return a "null-safe" object instead of throwing an error.
    if (!ctx) {
        return {
            agent: null,
            isLoggedIn: false,
            currentUser: null,
            login: async () => {},
            logout: async () => {},
        } as unknown as BlueskySessionCtx;
    }

    return ctx;
}
