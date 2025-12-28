export const updateThreadNode = (nodes: any[] | any, targetUri: string, updateFn: (node: any) => any): any => {
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