'use client';

import { Markdown } from '@astryxdesign/core/Markdown';
import { mathPlugins } from './math-plugins';

type Props = {
  text: string;
  isStreaming?: boolean;
};

export const AssistantContent = ({ text, isStreaming }: Props) => {
  if (!text) return null;
  return (
    <Markdown
      density="default"
      headingLevelStart={3}
      contentWidth={680}
      isStreaming={isStreaming}
      inlinePlugins={mathPlugins as never}
    >
      {text}
    </Markdown>
  );
};
