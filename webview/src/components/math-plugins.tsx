'use client';

import katex from 'katex';
import { Text } from '@astryxdesign/core/Text';

export const mathPlugins = [
  {
    pattern: /\$\$([\s\S]+?)\$\$/g,
    render: (match: RegExpMatchArray, key: number) => {
      try {
        const html = katex.renderToString(match[1], { displayMode: true, throwOnError: false });
        return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <Text key={key} as="span" type="inherit">{match[0]}</Text>;
      }
    },
  },
  {
    pattern: /\$([^$\n]+?)\$/g,
    render: (match: RegExpMatchArray, key: number) => {
      try {
        const html = katex.renderToString(match[1], { displayMode: false, throwOnError: false });
        return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <Text key={key} as="span" type="inherit">{match[0]}</Text>;
      }
    },
  },
];
