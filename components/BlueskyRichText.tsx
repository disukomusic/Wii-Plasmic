import React from 'react';
import { RichText } from '@atproto/api';

interface BlueskyRichTextProps {
    record: {
        text: string;
        facets?: any[];
    };
    onTagClick?: (tag: string) => void;
    className?: string;
}

export const BlueskyRichText: React.FC<BlueskyRichTextProps> = ({
        record,
        onTagClick,
        className
    }) => {
    if (!record) return null;

    // Initialize RichText helper
    const rt = new RichText({
        text: record.text,
        facets: record.facets,
    });

    const segments = [];
    let i = 0;

    // Segmenting breaks the text into parts (links, tags, mentions, plain text)
    for (const segment of rt.segments()) {
        if (segment.isLink()) {
            segments.push(
                <a
                    key={i++}
                    href={segment.link?.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#61C1DF', textDecoration: 'underline' }}
                >
                    {segment.text}
                </a>
            );
        } else if (segment.isTag()) {
            segments.push(
                <span
                    key={i++}
                    onClick={() => onTagClick?.(segment.tag?.tag || '')}
                    style={{ color: '#61C1DF', cursor: 'pointer', fontWeight: '600' }}
                >
          {segment.text}
        </span>
            );
        } else if (segment.isMention()) {
            segments.push(
                <span key={i++} style={{ color: '#61C1DF' }}>
            {segment.text}
          </span>
            );
        } else {
            segments.push(<span key={i++}>{segment.text}</span>);
        }
    }

    return <div className={className} style={{ whiteSpace: 'pre-wrap' }}>{segments}</div>;
};