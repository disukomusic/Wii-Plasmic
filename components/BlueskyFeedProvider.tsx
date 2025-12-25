/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/display-name */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { BskyAgent } from '@atproto/api';
import { DataProvider } from '@plasmicapp/host';

// --- Types ---
type FeedMode = 'author' | 'timeline' | 'feed' | 'search';

interface BlueskyProps {
  mode: FeedMode;
  actor?: string;       // For 'author' mode
  feedUrl?: string;     // For 'feed' mode (accepts at:// or https://bsky.app/...)
  searchQuery?: string; // For 'search' mode
  limit?: number;
  identifier?: string;
  appPassword?: string;
  children: any;
}

// --- Helper: Parse Feed URI ---
// Converts "https://bsky.app/profile/user.bsky.social/feed/feed-name" 
// to "at://did:plc:1234.../app.bsky.feed.generator/feed-name"
// --- Helper: Parse Feed URI ---
const resolveFeedUri = async (agent: BskyAgent, url: string): Promise<string | null> => {
  if (!url) return null;
  if (url.startsWith('at://')) return url;

  // Regex matches both handles and DIDs in the URL
  const match = url.match(/profile\/([^/]+)\/feed\/([^/]+)/);
  
  if (match) {
    const identifier = match[1]; // This could be "user.bsky.social" OR "did:plc:..."
    const feedId = match[2];
    
    let did = identifier;

    try {
      // ONLY resolve if it is NOT already a DID
      if (!identifier.startsWith('did:')) {
        const res = await agent.resolveHandle({ handle: identifier });
        did = res.data.did;
      }
      
      return `at://${did}/app.bsky.feed.generator/${feedId}`;
    } catch (e) {
      console.error("Failed to resolve feed identifier:", e);
      return null;
    }
  }
  return null;
};

// --- Constant: Official 'Discover' Feed URI (Whats Hot) ---
// This is the URI for the standard "Discover" feed maintained by Bluesky
const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

export const BlueskyFeedProvider = forwardRef((props: BlueskyProps, ref) => {
  const { 
    mode = 'author', 
    actor, 
    feedUrl, 
    searchQuery, 
    limit = 20, 
    identifier, 
    appPassword, 
    children 
  } = props;

  const [posts, setPosts] = useState<any[]>([]);
  const [agent] = useState(() => new BskyAgent({ service: 'https://bsky.social' }));
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Main Fetch Logic ---
  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      let data: any[] = [];

      switch (mode) {
        case 'timeline':
          // Requires Auth usually
          if (!agent.hasSession) {
             console.warn("Timeline requires login");
             // Fallback to public discovery if not logged in, or return empty
             // logic: let's try, if fail we catch
          }
          const tlRes = await agent.getTimeline({ limit });
          data = tlRes.data.feed;
          break;

        case 'search':
          if (!searchQuery) break;
          const searchRes = await agent.app.bsky.feed.searchPosts({ q: searchQuery, limit });
          // Search returns "posts", not "feed" items (feed items have reply/reason context)
          // We wrap them to match the structure of other feeds
          data = searchRes.data.posts.map(post => ({ post })); 
          break;

        case 'feed':
          // Handle explicit URL or default to Discover if URL is missing/preset
          const rawUrl = feedUrl || DISCOVER_FEED_URI; 
          const uri = await resolveFeedUri(agent, rawUrl);
          
          if (uri) {
            const feedRes = await agent.app.bsky.feed.getFeed({ feed: uri, limit });
            data = feedRes.data.feed;
          } else {
            setError("Invalid Feed URL");
          }
          break;

        case 'author':
        default:
          if (!actor) break;
          const authorRes = await agent.getAuthorFeed({ actor, limit, filter: 'posts_no_replies' });
          data = authorRes.data.feed;
          break;
      }

      setPosts(data);

    } catch (e: any) {
      console.error("Fetch failed:", e);
      setError(e.message || "Error fetching feed");
    } finally {
      setLoading(false);
    }
  }, [agent, mode, actor, feedUrl, searchQuery, limit]);

  // Initial fetch
  useEffect(() => {
    // If timeline, wait for login unless we want to try (it will fail without auth)
    if (mode === 'timeline' && !isLoggedIn) return; 
    
    fetchFeed();
  }, [fetchFeed, mode, isLoggedIn]); // Re-fetch if mode changes or user logs in

  // --- Exposed Actions ---
  useImperativeHandle(ref, () => ({
    login: async () => {
      if (!identifier || !appPassword) {
        console.error("Missing credentials");
        return;
      }
      try {
        setLoading(true);
        await agent.login({ identifier, password: appPassword });
        setIsLoggedIn(true);
        console.log("Logged in");
        await fetchFeed(); // Refresh context for new user
      } catch (e) {
        console.error("Login failed:", e);
      } finally {
        setLoading(false);
      }
    },

    likePost: async (uri: string, cid: string) => {
      if (!agent.hasSession) return console.error("Not logged in");

      // Optimistic update logic (same as before)
      const targetPost = posts.find(p => p.post.uri === uri);
      if(!targetPost) return;

      const isAlreadyLiked = !!targetPost.post.viewer?.like;

      setPosts(prev => prev.map(item => {
        if (item.post.uri !== uri) return item;
        const currentCount = item.post.likeCount || 0;
        return {
          ...item,
          post: {
            ...item.post,
            likeCount: isAlreadyLiked ? Math.max(0, currentCount - 1) : currentCount + 1,
            viewer: { 
              ...item.post.viewer, 
              like: isAlreadyLiked ? undefined : 'pending' 
            }
          }
        };
      }));

      try {
        if (isAlreadyLiked) {
          await agent.deleteLike(targetPost.post.viewer.like);
        } else {
          const res = await agent.like(uri, cid);
          // Confirm with actual URI
          setPosts(prev => prev.map(item => 
            item.post.uri === uri 
              ? { ...item, post: { ...item.post, viewer: { ...item.post.viewer, like: res.uri } } }
              : item
          ));
        }
      } catch (e) {
        console.error("Like action failed");
        fetchFeed(); // Revert on fail
      }
    }
  }));

  return (
    <DataProvider name="bskyData" data={{ posts, loading, isLoggedIn, error }}>
      {children}
    </DataProvider>
  );
});