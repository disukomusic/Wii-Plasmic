export const flattenEmbed = (embed: any) => {
    if (!embed) return null;
    let record = embed.record;
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
        record = embed.record.record;
    }
    if (!record) return null;
    if (record.author) return record; // Top level quote
    if (record.record?.author) return record.record; // Nested quote
    return null;
};

export const getDisplayImages = (embed: any) => {
    if (!embed) return [];
    if (Array.isArray(embed.images)) return embed.images;
    if (embed.media && Array.isArray(embed.media.images)) return embed.media.images;
    if (embed.external?.thumb) {
        return [{ fullsize: embed.external.thumb, thumb: embed.external.thumb, alt: embed.external.title }];
    }
    return [];
};

export const getDisplayVideo = (embed: any) => {
    if (!embed) return null;
    if (embed.$type === 'app.bsky.embed.video#view') return { playlist: embed.playlist, thumbnail: embed.thumbnail, alt: embed.alt, cid: embed.cid };
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media?.$type === 'app.bsky.embed.video#view') {
        return { playlist: embed.media.playlist, thumbnail: embed.media.thumbnail, alt: embed.media.alt, cid: embed.media.cid };
    }
    return null;
};

// Main normalizer: Converts raw API node to a clean "Post" object
export const normalizePost = (node: any) => {
    const post = node?.post ? node.post : node; // Handle if it's already a post view vs thread view
    if (!post?.uri) return null;

    const embed = post.embed;

    const isRepost = node?.reason?.$type === 'app.bsky.feed.defs#reasonRepost'; //
    const repostedBy = isRepost ? node.reason.by : null; //


    return {
        post,
        repostedBy,
        parent: node.reply?.parent ? normalizePost(node.reply.parent) : null,
        quote: flattenEmbed(embed),
        displayImages: getDisplayImages(embed),
        displayVideo: getDisplayVideo(embed),
        externalLink: embed?.$type === 'app.bsky.embed.external#view' ? embed.external : null,
        // Keep children/replies attached if we are normalizing a tree node
        replies: node.replies ? node.replies.map(normalizePost).filter(Boolean) : [],
        likers: []
    };
};


