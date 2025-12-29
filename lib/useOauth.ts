
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
        let mounted = true;
        setIsInitializing(true);

        (async () => {
            try {
                const c = await BrowserOAuthClient.load({
                    clientId,
                    handleResolver,
                    responseMode,
                    plcDirectoryUrl,
                    fetch: globalThis.fetch,
                    signal: ac.signal,
                });

                if (!mounted || ac.signal.aborted) {
                    // If we were aborted during load, free resources and bail.
                    c.dispose();
                    return;
                }

                clientRef.current = c;
                setClient(c);

                try {
                    const r = await c.init();
                    if (!mounted || ac.signal.aborted) return;
                    if (r) setSession(r.session);
                } catch (err) {
                    // If the init was aborted, silently ignore.
                    if ((err as any)?.name === "AbortError") {
                        // No-op: effect was cleaned up.
                    } else if (err instanceof LoginContinuedInParentWindowError) {
                        if (mounted) setIsLoginPopup(true);
                    } else {
                        console.error("OAuth init failed:", err);
                    }
                }
            } catch (err) {
                // If the load was aborted, silently ignore.
                if ((err as any)?.name !== "AbortError") {
                    console.error("OAuth client load failed:", err);
                }
            } finally {
                if (mounted && !ac.signal.aborted) setIsInitializing(false);
            }
        })();

        return () => {
            mounted = false;
            // Make cleanup idempotent; abort may throw in some environments, so guard.
            if (!ac.signal.aborted) {
                try {
                    ac.abort();
                } catch {
                    // Ignore any abort errors in cleanup.
                }
            }
        };
    }, [clientId, handleResolver, responseMode, plcDirectoryUrl]);

    const signIn = useCallback(
        async (input: string, authorizeOptions?: AuthorizeOptions) => {
            if (!clientRef.current) throw new Error("OAuth client not ready");

            const state = authorizeOptions?.state ?? (await getState()) ?? undefined;
            const scope = authorizeOptions?.scope ?? (await getScope()) ?? "atproto";

            const s = await clientRef.current.signIn(input, {
                ...authorizeOptions,
                scope,
                state,
            });

            setSession(s);
            return s;
        },
        [getScope, getState]
    );

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
