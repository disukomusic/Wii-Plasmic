/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react/display-name */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { BskyAgent } from '@atproto/api';
import { DataProvider } from '@plasmicapp/host';
import { useBluesky } from '@/lib/BlueskyAuthProvider';
import { compressImage, coerceToBlob } from '@/lib/MediaUtils';
import { flattenEmbed, getDisplayImages, getDisplayVideo, normalizePost} from '@/lib/NormalizeUtils'

/* =========================================================================================
 * URI & EMBED HELPERS
 * ========================================================================================= */
const resolveFeedUri = async (agent: BskyAgent, url: string): Promise<string | null> => {
  if (!url) return null;
  if (url.startsWith('at://')) return url;
  const match = url.match(/profile\/([^/]+)\/feed\/([^/]+)/);
  if (match) {
    const identifier = match[1];
    const feedId = match[2];
    try {
      let did = identifier;
      if (!identifier.startsWith('did:')) {
        const res = await agent.resolveHandle({ handle: identifier });
        did = res.data.did;
      }
      return `at://${did}/app.bsky.feed.generator/${feedId}`;
    } catch (e) {
      return null;
    }
  }
  return null;
};

const createEmbed = (uploadedImages: any[], quoteUri?: string, quoteCid?: string) => {
  const imageEmbed = uploadedImages.length > 0 ? {
    $type: 'app.bsky.embed.images',
    images: uploadedImages.map((img) => ({ image: img.blob, alt: img.alt || '' }))
  } : null;

  const quoteEmbed = (quoteUri && quoteCid) ? {
    $type: 'app.bsky.embed.record',
    record: { uri: quoteUri, cid: quoteCid },
  } : null;

  if (imageEmbed && quoteEmbed) {
    return { $type: 'app.bsky.embed.recordWithMedia', media: imageEmbed, record: quoteEmbed };
  }
  return imageEmbed || quoteEmbed || undefined;
};

/* =========================================================================================
 * TYPES
 * ========================================================================================= */
type FeedMode = 'author' | 'timeline' | 'feed' | 'search' | 'thread';

interface BlueskyProps {
  mode: FeedMode;
  actor?: string;
  feedUrl?: string;
  searchQuery?: string;
  limit?: number;
  identifier?: string;
  appPassword?: string;
  children: any;
  auth: boolean;

  // Thread Props
  threadUri?: string;       // The URI of the post to FOCUS on
  threadDepth?: number;     // How deep to fetch replies (default 6)
  threadParentHeight?: number; // How many parents up to fetch (default 80)
}

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

/* =========================================================================================
 * PROVIDER COMPONENT
 * ========================================================================================= */
export const BlueskyFeedProvider = forwardRef((props: BlueskyProps, ref) => {
  const {
    mode = 'author',
    actor,
    feedUrl,
    searchQuery,
    limit = 20,
    threadUri,
    children
  } = props;

  const { agent, isLoggedIn, currentUser, login, logout } = useBluesky();

  // --- General Feed State ---
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Interaction State ---
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [savedFeeds, setSavedFeeds] = useState<any[]>([]);

  // --- Thread State (Native Structure) ---
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // We store the thread in 3 distinct parts for easy rendering:
  const [threadAncestors, setThreadAncestors] = useState<any[]>([]); // Parent chain
  const [threadFocused, setThreadFocused] = useState<any>(null);     // The main post
  const [threadReplies, setThreadReplies] = useState<any[]>([]);     // The children tree

  /* -----------------------------------------------------------------------------
   * THREAD FETCHING
   * ----------------------------------------------------------------------------- */
  const fetchThread = useCallback(async () => {
    if (!threadUri) return;

    setThreadLoading(true);
    setThreadError(null);

    try {
      const res = await agent.getPostThread({
        uri: threadUri,
        depth: props.threadDepth ?? 6,
        parentHeight: props.threadParentHeight ?? 80
      });

      const root = res.data.thread;

      // 1. Handle Blocked/Not Found
      if (!root?.post?.uri) {
        setThreadError("Post not found or blocked");
        setThreadAncestors([]);
        setThreadFocused(null);
        setThreadReplies([]);
        return;
      }

      // 2. Parse Ancestors (Walk up the parent chain)
      const ancestorsRaw: any[] = [];
      let current = root.parent;
      while (current) {
        if (current.post) ancestorsRaw.push(current);
        current = current.parent;
      }
      // Reverse so it goes [Grandparent, Parent, ...] (Top to Bottom)
      const ancestors = ancestorsRaw.reverse().map(normalizePost);

      // 3. Parse Focused Post
      const focused = normalizePost(root);

      // 4. Parse Replies (Recursive Tree)
      // The API returns 'replies' on the root node. We normalize them recursively.
      const replies = (root.replies || []).map((r: any) => normalizePost(r)).filter(Boolean);

      // Set State
      setThreadAncestors(ancestors);
      setThreadFocused(focused);
      setThreadReplies(replies);

    } catch (e: any) {
      console.error("Thread fetch failed:", e);
      setThreadError(e?.message ?? "Failed to fetch thread");
    } finally {
      setThreadLoading(false);
    }
  }, [agent, threadUri, props.threadDepth, props.threadParentHeight]);
  
  /* -----------------------------------------------------------------------------
   * GENERAL FEED FETCHING
   * ----------------------------------------------------------------------------- */
  const fetchFeed = useCallback(async () => {
    // If in thread mode, we use fetchThread instead
    if (mode === 'thread') {
      await fetchThread();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let data: any[] = [];

      switch (mode) {
        case 'timeline':
          if (agent.hasSession) {
            const tlRes = await agent.getTimeline({ limit });
            data = tlRes.data.feed;
          }
          break;
        case 'search':
          if (searchQuery) {
            const searchRes = await agent.app.bsky.feed.searchPosts({ q: searchQuery, limit });
            data = searchRes.data.posts.map(post => ({ post }));
          }
          break;
        case 'feed':
          const rawUrl = feedUrl || DISCOVER_FEED_URI;
          const uri = await resolveFeedUri(agent, rawUrl);
          if (uri) {
            const feedRes = await agent.app.bsky.feed.getFeed({ feed: uri, limit });
            data = feedRes.data.feed;
          }
          break;
        case 'author':
        default:
          if (actor) {
            const authorRes = await agent.getAuthorFeed({ actor, limit, filter: 'posts_no_replies' });
            data = authorRes.data.feed;
          }
          break;
      }

      // Normalize generic list
      const normalizedData = data.map((item: any) => normalizePost(item));
      setPosts(normalizedData);
    } catch (e: any) {
      console.error("Fetch failed:", e);
      setError(e.message || "Error fetching feed");
    } finally {
      setLoading(false);
    }
  }, [agent, mode, actor, feedUrl, searchQuery, limit, fetchThread]);

  // Trigger fetch on prop changes
  useEffect(() => {
    if (loading) return;
    const isTextInputMode = mode === 'search' || mode === 'author';
    const delay = isTextInputMode ? 500 : 0;

    // Immediate fetch for thread mode to feel snappy
    if (mode === 'thread') {
      fetchThread();
      return;
    }

    const handler = setTimeout(() => fetchFeed(), delay);
    return () => clearTimeout(handler);
  }, [mode, isLoggedIn, searchQuery, actor, limit, feedUrl, threadUri]);
  
  /* -----------------------------------------------------------------------------
   * PREFERENCES (Saved Feeds)
   * ----------------------------------------------------------------------------- */
  const fetchSavedFeeds = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const prefsRes = await agent.app.bsky.actor.getPreferences();
      const prefs = prefsRes.data.preferences;
      let feedUris: string[] = [];

      const v2 = prefs.find((p: any) => p.$type === "app.bsky.actor.defs#savedFeedsPrefV2");
      if (v2 && Array.isArray((v2 as any).items)) {
        (v2 as any).items.forEach((item: any) => {
          if (item.type === "feed" && item.value) feedUris.push(item.value);
        });
      }

      if (feedUris.length === 0) {
        const legacy = prefs.find((p: any) => p.$type === "app.bsky.actor.defs#savedFeedsPref");
        if (legacy) feedUris.push(...((legacy as any).saved || []), ...((legacy as any).pinned || []));
      }

      feedUris = [...new Set(feedUris)];
      if (feedUris.length === 0) {
        setSavedFeeds([]);
        return;
      }

      const metadataRes = await agent.app.bsky.feed.getFeedGenerators({ feeds: feedUris });
      setSavedFeeds(metadataRes.data.feeds.map(f => ({ uri: f.uri, ...f })));
    } catch (e) {
      console.error("Failed to fetch saved feeds:", e);
    }
  }, [agent, isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) fetchSavedFeeds();
  }, [isLoggedIn, fetchSavedFeeds]);


  /* -----------------------------------------------------------------------------
   * HELPER: Recursive Update for Thread Trees
   * Used for optimistic UI updates (Likes/Reposts)
   * ----------------------------------------------------------------------------- */
  const updateThreadNode = (nodes: any[] | any, targetUri: string, updateFn: (node: any) => any): any => {
    if (Array.isArray(nodes)) {
      return nodes.map(node => updateThreadNode(node, targetUri, updateFn));
    }
    if (!nodes || !nodes.post) return nodes;

    // If this is the node, update it
    if (nodes.post.uri === targetUri) {
      return updateFn(nodes);
    }

    // Otherwise, check its children (replies)
    if (nodes.replies && nodes.replies.length > 0) {
      return {
        ...nodes,
        replies: updateThreadNode(nodes.replies, targetUri, updateFn)
      };
    }

    return nodes;
  };

  /* -----------------------------------------------------------------------------
   * EXPOSED ACTIONS
   * ----------------------------------------------------------------------------- */
  useImperativeHandle(ref, () => ({
    login: async () => {
      if (props.identifier && props.appPassword) {
        await login(props.identifier, props.appPassword);
      }
    },
    logout: async () => {
      await logout();
      setPosts([]);
    },

    // --- Like Post (Handles both Thread and List modes) ---
    likePost: async (uri: string, cid?: string) => {
      if (!agent.hasSession) return;

      // 1. Identify current state to determine if we are Adding or Removing
      let isAlreadyLiked = false;
      let existingLikeUri: string | undefined;
      let cidToUse = cid;

      // Check Thread State
      if (mode === 'thread') {
        const checkNode = (n: any): any => {
          if (!n) return null;
          if (n.post?.uri === uri) return n;
          if (n.replies) {
            for(const r of n.replies) {
              const found = checkNode(r);
              if(found) return found;
            }
          }
          return null;
        };
        // Check focused, ancestors, or replies
        const node = checkNode(threadFocused)
            || threadAncestors.map(checkNode).find(Boolean)
            || threadReplies.map(checkNode).find(Boolean);

        if (node) {
          existingLikeUri = node.post.viewer?.like;
          cidToUse = cidToUse ?? node.post.cid;
        }
      }
      // Check List State
      else {
        const item = posts.find(p => p.post.uri === uri);
        if (item) {
          existingLikeUri = item.post.viewer?.like;
          cidToUse = cidToUse ?? item.post.cid;
        }
      }

      if (!cidToUse) return; // Can't like without CID
      isAlreadyLiked = !!(existingLikeUri && existingLikeUri !== 'pending');

      // 2. Optimistic Update Function
      const performUpdate = (prevItem: any) => {
        const currentCount = prevItem.post.likeCount || 0;
        return {
          ...prevItem,
          post: {
            ...prevItem.post,
            likeCount: isAlreadyLiked ? Math.max(0, currentCount - 1) : currentCount + 1,
            viewer: {
              ...prevItem.post.viewer,
              like: isAlreadyLiked ? undefined : 'pending',
            }
          }
        };
      };

      // 3. Apply Optimistic Updates
      if (mode === 'thread') {
        setThreadFocused(prev => updateThreadNode(prev, uri, performUpdate));
        setThreadAncestors(prev => updateThreadNode(prev, uri, performUpdate));
        setThreadReplies(prev => updateThreadNode(prev, uri, performUpdate));
      } else {
        setPosts(prev => prev.map(item => item.post.uri === uri ? performUpdate(item) : item));
      }

      // 4. API Call
      try {
        if (isAlreadyLiked) {
          await agent.deleteLike(existingLikeUri!);

          // When unliking, remove the current user from the likers array
          const removeSelf = (node: any) => ({
            ...node,
            // Filter out the current user's avatar from the local likers array
            likers: (node.likers || []).filter((l: any) => l.did !== currentUser?.did),
            post: { ...node.post, viewer: { ...node.post.viewer, like: undefined } }
          });

          if (mode === 'thread') {
            setThreadFocused(prev => updateThreadNode(prev, uri, removeSelf));
            setThreadAncestors(prev => updateThreadNode(prev, uri, removeSelf));
            setThreadReplies(prev => updateThreadNode(prev, uri, removeSelf));
          } else {
            setPosts(prev => prev.map(item => item.post.uri === uri ? removeSelf(item) : item));
          }
        } else {
          const res = await agent.like(uri, cidToUse);

          // Fetch the latest 5 likers to show avatars
          const likersRes = await agent.getLikes({ uri, limit: 5 });
          const latestLikers = likersRes.data.likes.map(l => l.actor);

          // Combine both updates: The official Like URI AND the Liker list
          const finalUpdate = (node: any) => ({
            ...node,
            likers: latestLikers, // This enables $props.currentItem.likers
            post: {
              ...node.post,
              viewer: { ...node.post.viewer, like: res.uri }
            }
          });

          if (mode === 'thread') {
            setThreadFocused(prev => updateThreadNode(prev, uri, finalUpdate));
            setThreadAncestors(prev => updateThreadNode(prev, uri, finalUpdate));
            setThreadReplies(prev => updateThreadNode(prev, uri, finalUpdate));
          } else {
            setPosts(prev => prev.map(item => item.post.uri === uri ? finalUpdate(item) : item));
          }
        }
      } catch (e) {
        console.error("Like failed, reverting", e);
        mode === 'thread' ? fetchThread() : fetchFeed();
      }
    },
    
    // --- Fetch post liker (users) ---
    fetchPostLikes: async (uri: string, limit: number = 20) => {
      if (!agent || !uri) return;

      try {
        // 1. Fetch the likers from the API
        const res = await agent.getLikes({ uri, limit });
        const actorList = res.data.likes.map(l => l.actor);

        // 2. Define the update function
        const updateWithLikers = (node: any) => ({
          ...node,
          likers: actorList // This populates $props.currentItem.likers
        });

        // 3. Apply to whichever state is currently active
        if (mode === 'thread') {
          setThreadFocused(prev => updateThreadNode(prev, uri, updateWithLikers));
          setThreadAncestors(prev => updateThreadNode(prev, uri, updateWithLikers));
          setThreadReplies(prev => updateThreadNode(prev, uri, updateWithLikers));
        } else {
          setPosts(prev => prev.map(item =>
              item.post.uri === uri ? updateWithLikers(item) : item
          ));
        }
      } catch (e) {
        console.error("Failed to load likers for action:", e);
      }
    },
    
    
    // --- Repost (Handles both Thread and List modes) ---
    repostPost: async (uri: string, cid: string) => {
      if (!agent.hasSession) return;

      // 1. Identify current state to determine if we are Adding or Removing
      let isAlreadyReposted = false;
      let existingRepostUri: string | undefined;
      let cidToUse: string | undefined = cid;

      // Check Thread State
      if (mode === 'thread') {
        const checkNode = (n: any): any => {
          if (!n) return null;
          if (n.post?.uri === uri) return n;
          if (n.replies) {
            for (const r of n.replies) {
              const found = checkNode(r);
              if (found) return found;
            }
          }
          return null;
        };

        // Check focused, ancestors, or replies
        const node =
            checkNode(threadFocused) ||
            threadAncestors.map(checkNode).find(Boolean) ||
            threadReplies.map(checkNode).find(Boolean);

        if (node) {
          existingRepostUri = node.post.viewer?.repost;
          cidToUse = cidToUse || node.post.cid;
        }
      }
      // Check List State
      else {
        const item = posts.find((p) => p.post.uri === uri);
        if (item) {
          existingRepostUri = item.post.viewer?.repost;
          cidToUse = cidToUse || item.post.cid;
        }
      }

      if (!cidToUse) return; // Can't repost without CID
      isAlreadyReposted = !!(existingRepostUri && existingRepostUri !== 'pending');

      // 2. Optimistic Update Function
      const performUpdate = (prevItem: any) => {
        const currentCount = prevItem.post.repostCount || 0;
        return {
          ...prevItem,
          post: {
            ...prevItem.post,
            repostCount: isAlreadyReposted
                ? Math.max(0, currentCount - 1)
                : currentCount + 1,
            viewer: {
              ...prevItem.post.viewer,
              repost: isAlreadyReposted ? undefined : 'pending',
            },
          },
        };
      };

      // 3. Apply Optimistic Updates
      if (mode === 'thread') {
        setThreadFocused((prev) => updateThreadNode(prev, uri, performUpdate));
        setThreadAncestors((prev) => updateThreadNode(prev, uri, performUpdate));
        setThreadReplies((prev) => updateThreadNode(prev, uri, performUpdate));
      } else {
        setPosts((prev) =>
            prev.map((item) => (item.post.uri === uri ? performUpdate(item) : item))
        );
      }

      // 4. API Call
      try {
        if (isAlreadyReposted) {
          // Remove repost
          await agent.deleteRepost(existingRepostUri!);

          // Clear any pending/old repost value in state (count already handled optimistically)
          const clearRepost = (node: any) => ({
            ...node,
            post: {
              ...node.post,
              viewer: { ...node.post.viewer, repost: undefined },
            },
          });

          if (mode === 'thread') {
            setThreadFocused((prev) => updateThreadNode(prev, uri, clearRepost));
            setThreadAncestors((prev) => updateThreadNode(prev, uri, clearRepost));
            setThreadReplies((prev) => updateThreadNode(prev, uri, clearRepost));
          } else {
            setPosts((prev) =>
                prev.map((item) => (item.post.uri === uri ? clearRepost(item) : item))
            );
          }
        } else {
          // Create repost
          const res = await agent.repost(uri, cidToUse);

          // Set the official repost record uri (replace "pending")
          const finalizeRepost = (node: any) => ({
            ...node,
            post: {
              ...node.post,
              viewer: { ...node.post.viewer, repost: res.uri },
            },
          });

          if (mode === 'thread') {
            setThreadFocused((prev) => updateThreadNode(prev, uri, finalizeRepost));
            setThreadAncestors((prev) => updateThreadNode(prev, uri, finalizeRepost));
            setThreadReplies((prev) => updateThreadNode(prev, uri, finalizeRepost));
          } else {
            setPosts((prev) =>
                prev.map((item) =>
                    item.post.uri === uri ? finalizeRepost(item) : item
                )
            );
          }
        }
      } catch (e) {
        console.error("Repost failed, reverting", e);
        mode === 'thread' ? fetchThread() : fetchFeed();
      }
    },


    createPost: async (text: string, images: any[] = [], quoteUri?: string, quoteCid?: string, replyParentUri?: string, replyParentCid?: string, replyRootUri?: string, replyRootCid?: string) => {
      if (!agent.hasSession) return;
      setPosting(true);
      try {

        const uploadedBlobs: any[] = [];

        if (images.length > 0) {
          for (const img of images.slice(0, 4)) {
            const rawBlob = coerceToBlob(img);

            if (!rawBlob) {
              console.warn("Skipping image: not convertible to Blob/File", img);
              continue;
            }

            console.log("rawBlob", rawBlob.type, rawBlob.size);

            const compressed = await compressImage(rawBlob);

            if (!compressed || compressed.size === 0) {
              console.warn("Skipping image: compression produced empty blob", {
                rawType: rawBlob.type,
                rawSize: rawBlob.size,
              });
              continue;
            }

            const encoding = compressed.type || "image/jpeg";
            const { data } = await agent.uploadBlob(compressed, { encoding });

            uploadedBlobs.push({ blob: data.blob, alt: "" });
          }
        }
        
        const embed = createEmbed(uploadedBlobs, quoteUri, quoteCid);
        const record: any = {
          $type: "app.bsky.feed.post",
          text: text.trim(),
          createdAt: new Date().toISOString(),
          embed: embed
        };

        if (replyParentUri && replyParentCid) {
          record.reply = {
            root: { uri: replyRootUri || replyParentUri, cid: replyRootCid || replyParentCid },
            parent: { uri: replyParentUri, cid: replyParentCid },
          };
        }

        await agent.post(record);

        // Refresh view
        mode === 'thread' ? fetchThread() : fetchFeed();
      } catch(e: any) {
        setPostError(e.message);
      } finally {
        setPosting(false);
      }
    }
  }));

  return (
      <DataProvider
          name="bskyData"
          data={{
            posts, // For Timeline/Feed/Search/Author
            loading,
            error,
            isLoggedIn,
            currentUser,
            savedFeeds,

            // THREAD SPECIFIC DATA
            // Use these to render the "Native" thread view
            threadAncestors,  // Render these first (opacity 0.7 maybe?)
            threadFocused,    // Render this big and bold
            threadReplies,    // Render these nested below

            threadLoading,
            threadError,

            // Actions status
            posting,
            postError,
          }}
      >
        {children}
      </DataProvider>
  );
});