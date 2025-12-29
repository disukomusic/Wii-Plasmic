
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useOAuth } from "@/lib/useOauth";
import { BskyAgent } from '@atproto/api';


type BlueskySessionCtx = {
    agent: any; // Agent | null
    isLoggedIn: boolean;
    currentUser: any | null;
    login: (identifier: string, appPassword?: string) => Promise<void>;
    logout: () => Promise<void>;
    authInitializing: boolean;
};

const BlueskyCtx = createContext<BlueskySessionCtx | null>(null);

const CLIENT_ID =
    process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID || "https://wii.suko.pet/client-metadata.json";

const IS_DEV = process.env.NODE_ENV === "development";

export function BlueskyAuthProvider({ children }: { children: React.ReactNode }) {
    
    const oauth = useOAuth({
        clientId: CLIENT_ID,
        handleResolver: "https://bsky.social",
        responseMode: "query",
        getScope: () => "atproto",
    });


    const [devAgent, setDevAgent] = useState<BskyAgent | null>(null);
    const [currentUser, setCurrentUser] = useState<any | null>(null);

    useEffect(() => {
        (async () => {
            if (IS_DEV) {
                if (!devAgent) { setCurrentUser(null); return; }

                const did = devAgent.session?.did;
                if (!did) {
                    // No session yet—e.g., before login or if resume failed
                    setCurrentUser(null);
                } else {
                    const profile = await devAgent.getProfile({ actor: did });
                    setCurrentUser(profile.data);
                }

                return;
            }


            if (!oauth.agent || !oauth.session) { setCurrentUser(null); return; }
            const profile = await oauth.agent.getProfile({ actor: oauth.session.did });
            
            setCurrentUser(profile.data);
        })();
    }, [IS_DEV, devAgent]);

    
    const DEV_SESSION_KEY = 'bskyDevSession';

    const makeDevAgent = () =>
        new BskyAgent({
            service: 'https://bsky.social',
            // This callback is invoked whenever the agent updates its session.
            persistSession: (evt, session) => {
                if (session) {
                    localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(session));
                } else {
                    localStorage.removeItem(DEV_SESSION_KEY);
                }
            },
        });


    useEffect(() => {
        if (!IS_DEV) return;

        const saved = typeof window !== 'undefined'
            ? localStorage.getItem(DEV_SESSION_KEY)
            : null;

        if (!saved) {
            setDevAgent(null);
            return;
        }

        (async () => {
            try {
                const session = JSON.parse(saved);
                const agent = makeDevAgent();
                await agent.resumeSession(session);
                setDevAgent(agent);
            } catch (err) {
                console.error('Failed to resume dev session', err);
                localStorage.removeItem(DEV_SESSION_KEY);
                setDevAgent(null);
            }
        })();
    }, []);


    const login = async (identifier: string, appPassword?: string) => {
        if (IS_DEV) {
            const agent = makeDevAgent();
            await agent.login({ identifier, password: appPassword! });
            setDevAgent(agent);
        } else {
            await oauth.signIn(identifier); // unchanged
        }
    };

    
    const logout = async () => {
        await oauth.signOut();        
        setCurrentUser(null);
    }
    
    const activeAgent = IS_DEV ? devAgent : oauth.agent;
    const isLoggedIn = !!activeAgent?.session?.did;

    const value = useMemo(
        () => ({ 
            agent: activeAgent, 
            isLoggedIn, 
            currentUser,
            login, 
            logout,
            authInitializing: oauth.isInitializing,
        }),
        [activeAgent, isLoggedIn, currentUser, oauth.isInitializing]
    );
    
    useEffect(() => {
        console.log('[oauth] isInitializing=', oauth.isInitializing,
            'did=', oauth.session?.did,
            'agent?', !!oauth.agent);
    }, [oauth.isInitializing, oauth.session, oauth.agent]);

    
    return <BlueskyCtx.Provider value={value}>{children}</BlueskyCtx.Provider>;
}

export function useBluesky() {
    const ctx = useContext(BlueskyCtx);
    if (!ctx) throw new Error("useBluesky must be used inside BlueskyAuthProvider");
    return ctx;
}
