export type FeedMode = 'author' | 'timeline' | 'feed' | 'search' | 'thread';

export interface BlueskyProps {
    mode: FeedMode;
    actor?: string;
    feedUrl?: string;
    searchQuery?: string;
    limit?: number;
    identifier?: string;
    appPassword?: string;
    children: any;
    auth: boolean;
    threadUri?: string;
    threadDepth?: number;
    threadParentHeight?: number;
}

export const DISCOVER_FEED_URI =
    'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
