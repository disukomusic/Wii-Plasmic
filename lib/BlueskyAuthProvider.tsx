
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useOAuth } from "@/lib/useOauth";

type BlueskySessionCtx = {
    agent: any; // Agent | null
    isLoggedIn: boolean;
    currentUser: any | null;
    login: (identifier: string, appPassword?: string) => Promise<void>;
    logout: () => Promise<void>;
};

const BlueskyCtx = createContext<BlueskySessionCtx | null>(null);

// Prefer env override; otherwise use current origin's API route
const DEFAULT_CLIENT_ID =
    typeof window !== "undefined"
        ? `${window.location.origin}/api/client-metadata`
        : ""; // server-side render will be empty; client will fill

const CLIENT_ID =
    process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID ?? DEFAULT_CLIENT_ID;

export function BlueskyAuthProvider({ children }: { children: React.ReactNode }) {
    const { agent, session, isInitializing, signIn, signOut } = useOAuth({
        clientId: CLIENT_ID,
        handleResolver: "https://bsky.social",
        responseMode: "query",
        getScope: () => "atproto transition:generic",

    });

    const [currentUser, setCurrentUser] = useState<any | null>(null);
    const isLoggedIn = !!agent && !!session && !isInitializing;

    useEffect(() => {
        (async () => {
            if (!agent || !session) {
                setCurrentUser(null);
                return;
            }
            const profile = await agent.getProfile({ actor: session.did });
            setCurrentUser(profile.data);
        })();
    }, [agent, session]);

    const login = async (identifier: string, _appPassword?: string) => {
        await signIn(identifier);
    };

    const logout = async () => {
        await signOut();
        setCurrentUser(null);
    };

    const value = useMemo(
        () => ({ agent, isLoggedIn, currentUser, login, logout }),
        [agent, isLoggedIn, currentUser]
    );

    return <BlueskyCtx.Provider value={value}>{children}</BlueskyCtx.Provider>;
}

export function useBluesky() {
    const ctx = useContext(BlueskyCtx);
    if (!ctx) throw new Error("useBluesky must be used inside BlueskyAuthProvider");
    return ctx;
}
``
