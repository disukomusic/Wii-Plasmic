/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/display-name */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { BskyAgent } from '@atproto/api';
import { DataProvider } from '@plasmicapp/host';

// --- Types ---
type FeedMode = 'author' | 'timeline' | 'feed' | 'search';

interface BlueskyProps {
  mode: FeedMode;
  actor?: string;       // For 'author' mode
  feedUrl?: string;     // For 'feed' mode
  searchQuery?: string; // For 'search' mode
  limit?: number;
  identifier?: string;
  appPassword?: string;
  children: any;
  auth: boolean;
}

// --- Helper: Parse Feed URI ---
const resolveFeedUri = async (agent: BskyAgent, url: string): Promise<string | null> => {
  if (!url) return null;
  if (url.startsWith('at://')) return url;

  const match = url.match(/profile\/([^/]+)\/feed\/([^/]+)/);

  if (match) {
    const identifier = match[1];
    const feedId = match[2];
    let did = identifier;

    try {
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

// --- Constant: Official 'Discover' Feed URI ---
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

  // --- State ---
  const [posts, setPosts] = useState<any[]>([]);
  const [agent] = useState(() => new BskyAgent({ service: 'https://bsky.social' }));
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // New State for Likes
  const [currentPostLikes, setCurrentPostLikes] = useState<any[]>([]);
  const [likesLoading, setLikesLoading] = useState(false);

  // --- Main Fetch Logic ---
  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let data: any[] = [];

      switch (mode) {
        case 'timeline':
          if (!agent.hasSession) {
            console.warn("Timeline requires login");
          }
          const tlRes = await agent.getTimeline({ limit });
          data = tlRes.data.feed;
          break;

        case 'search':
          if (!searchQuery) break;
          const searchRes = await agent.app.bsky.feed.searchPosts({ q: searchQuery, limit });
          data = searchRes.data.posts.map(post => ({ post }));
          break;

        case 'feed':
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
    const isTextInputMode = mode === 'search' || mode === 'author';
    if (mode === 'timeline' && !isLoggedIn) return;

    const handler = setTimeout(() => {
      fetchFeed();
    }, isTextInputMode ? 500 : 0);

    return () => clearTimeout(handler);
  }, [fetchFeed, mode, isLoggedIn, searchQuery, actor]);

  // --- Exposed Actions ---
  useImperativeHandle(ref, () => ({
    login: async () => {
      if (!identifier || !appPassword) return;
      try {
        setLoading(true);
        const session = await agent.login({ identifier, password: appPassword });
        const profile = await agent.getProfile({ actor: session.data.did });
        setCurrentUser(profile.data);
        setIsLoggedIn(true);
        await fetchFeed();
      } catch (e) {
        console.error("Login failed:", e);
      } finally {
        setLoading(false);
      }
    },

    logout: async () => {
      try {
        setLoading(true);
        await agent.logout();
        setIsLoggedIn(false);
        setCurrentUser(null);
        setPosts([]);
        setError(null);
        setCurrentPostLikes([]); // Clear likes on logout
        if (mode !== 'timeline') {
          await fetchFeed();
        }
      } catch (e) {
        console.error("Logout failed:", e);
      } finally {
        setLoading(false);
      }
    },

    fetchPostLikes: async (uri: string, maxLikers: number = 10) => {
      try {
        // Set loading state for this specific post
        setPosts(prev => prev.map(item =>
            item.post.uri === uri ? { ...item, likesLoading: true } : item
        ));

        // We pass the 'limit' to the getLikes call
        const res = await agent.getLikes({
          uri,
          limit: maxLikers
        });

        setPosts(prev => prev.map(item =>
            item.post.uri === uri
                ? {
                  ...item,
                  likers: res.data.likes, // Now limited by the API side
                  likesLoading: false
                }
                : item
        ));
      } catch (e: any) {
        console.error("Failed to fetch post likes:", e);
        setPosts(prev => prev.map(item =>
            item.post.uri === uri ? { ...item, likesLoading: false } : item
        ));
      }
    },

    likePost: async (uri: string, cid: string) => {
      if (!agent.hasSession) return console.error("Not logged in");

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
          setPosts(prev => prev.map(item =>
              item.post.uri === uri
                  ? { ...item, post: { ...item.post, viewer: { ...item.post.viewer, like: res.uri } } }
                  : item
          ));
        }
      } catch (e) {
        console.error("Like action failed");
        fetchFeed();
      }
    },

    repostPost: async (uri: string, cid: string) => {
      if (!agent.hasSession) return console.error("No active session");

      const targetPost = posts.find(p => p.post.uri === uri);
      if (!targetPost) return;

      const existingRepostUri = targetPost.post.viewer?.repost;
      const isAlreadyReposted = !!existingRepostUri && existingRepostUri !== 'pending';

      setPosts(prev => prev.map(item => {
        if (item.post.uri !== uri) return item;
        const currentCount = item.post.repostCount || 0;
        return {
          ...item,
          post: {
            ...item.post,
            repostCount: isAlreadyReposted ? Math.max(0, currentCount - 1) : currentCount + 1,
            viewer: {
              ...item.post.viewer,
              repost: isAlreadyReposted ? undefined : 'pending'
            }
          }
        };
      }));

      try {
        if (isAlreadyReposted) {
          await agent.deleteRepost(existingRepostUri);
        } else {
          const res = await agent.repost(uri, cid);
          setPosts(prev => prev.map(item =>
              item.post.uri === uri
                  ? { ...item, post: { ...item.post, viewer: { ...item.post.viewer, repost: res.uri } } }
                  : item
          ));
        }
      } catch (e) {
        console.error("Bluesky API Error:", e);
        fetchFeed();
      }
    }
  }));

  return (
      <DataProvider
          name="bskyData"
          data={{
            posts,
            loading,
            isLoggedIn,
            currentUser,
            currentPostLikes,
            likesLoading
          }}
      >
        {children}
      </DataProvider>
  );
});