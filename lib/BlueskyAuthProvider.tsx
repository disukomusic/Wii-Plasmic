
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

const CLIENT_ID =
    process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID || "https://wii.suko.pet/client-metadata.json";

export function BlueskyAuthProvider({ children }: { children: React.ReactNode }) {
    const { agent, session, isInitializing, signIn, signOut } = useOAuth({
        clientId: CLIENT_ID,
        handleResolver: "https://bsky.social",
        responseMode: "query",
        getScope: () => "atproto transition:generic transition:chat.bsky",
    });

    const [currentUser, setCurrentUser] = useState<any | null>(null);
    const [hasFetchedUser, setHasFetchedUser] = useState(false);

    const isLoggedIn = !!agent && !!session && !isInitializing;

    useEffect(() => {
        if (!agent || !session || hasFetchedUser) {
            if (!session) {
                setCurrentUser(null);
                setHasFetchedUser(false);
            }
            return;
        }

        (async () => {
            try {
                const profile = await agent.getProfile({ actor: session.did });
                setCurrentUser(profile.data);
                setHasFetchedUser(true);
            } catch (err) {
                console.error("Failed to fetch profile:", err);
            }
        })();
    }, [agent, session, hasFetchedUser]);

    const login = async (identifier: string, _appPassword?: string) => {
        console.log("login called with:", identifier);
        await signIn(identifier);
        console.log("signIn completed (should not reach here if redirect worked)");
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
