
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Agent } from "@atproto/api";
import {
    AuthorizeOptions,
    BrowserOAuthClient,
    OAuthSession,
    LoginContinuedInParentWindowError,
} from "@atproto/oauth-client-browser";

type Gettable<T> = () => PromiseLike<T> | T;

export function useOAuth(options: {
    clientId: string;
    handleResolver: string;
    responseMode?: "query" | "fragment";
    plcDirectoryUrl?: string;
    getScope?: Gettable<string | undefined>;
    getState?: Gettable<string | undefined>;
}) {
    const {
        clientId,
        handleResolver,
        responseMode = "query",
        plcDirectoryUrl,
    } = options;

    const getScope = options.getScope ?? (() => "atproto");
    const getState = options.getState ?? (() => undefined);

    const [client, setClient] = useState<BrowserOAuthClient | null>(null);
    const [session, setSession] = useState<OAuthSession | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [isLoginPopup, setIsLoginPopup] = useState(false);

    const clientRef = useRef<BrowserOAuthClient | null>(null);

    // Initialize client and restore/complete login
    useEffect(() => {
        const ac = new AbortController();
        setIsInitializing(true);

        BrowserOAuthClient.load({
            clientId,
            handleResolver,
            responseMode,
            plcDirectoryUrl,
            fetch: globalThis.fetch,
            signal: ac.signal,
        })
            .then(async (c) => {
                if (ac.signal.aborted) {
                    c.dispose();
                    return;
                }
                clientRef.current = c;
                setClient(c);

                try {
                    const r = await c.init();
                    if (r) {
                        setSession(r.session);
                    }
                } catch (err) {
                    if (err instanceof LoginContinuedInParentWindowError) {
                        setIsLoginPopup(true);
                    } else {
                        console.error("OAuth init failed:", err);
                    }
                }
            })
            .finally(() => {
                if (!ac.signal.aborted) setIsInitializing(false);
            });

        return () => ac.abort();
    }, [clientId, handleResolver, responseMode, plcDirectoryUrl]);

    const signIn = async (handle: string) => {
        if (!client) {
            throw new Error("OAuth client not initialized");
        }

        try {
            const scope = await getScope();
            const state = await getState();

            await client.signIn(handle, {
                scope,
                state,
                signal: new AbortController().signal,
            });
        } catch (error) {
            console.error("OAuth signIn failed:", error);
            throw error;
        }
    };



    const signOut = useCallback(async () => {
        await session?.signOut();
        setSession(null);
    }, [session]);

    return useMemo(
        () => ({
            isInitializing,
            isInitialized: !!client,
            isLoginPopup,
            session,
            client,
            signIn,
            signOut,
            agent: session ? new Agent(session) : null,
        }),
        [isInitializing, isLoginPopup, session, client, signIn, signOut]
    );
}
