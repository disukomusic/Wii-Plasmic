import {BskyAgent} from "@atproto/api";

export const resolveFeedUri = async (agent: BskyAgent, url: string): Promise<string | null> => {
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

export const createEmbed = (uploadedImages: any[], quoteUri?: string, quoteCid?: string) => {
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
