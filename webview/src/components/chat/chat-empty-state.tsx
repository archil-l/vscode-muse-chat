'use client';

import type { CSSProperties } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Center } from '@astryxdesign/core/Center';
import { Text, Heading } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { SparklesIcon, CommandLineIcon, BeakerIcon } from '@heroicons/react/24/outline';
import katex from 'katex';

const suggestions = [
  { label: 'Explain this codebase', icon: CommandLineIcon, hint: 'Explain this codebase structure' },
  { label: 'Write a function', icon: BeakerIcon, hint: 'Write a function to debounce input in TypeScript' },
  { label: 'Debug help', icon: SparklesIcon, hint: 'Help me debug an error: `Cannot read property of undefined`' },
] as const;

type Props = {
  onSuggestionClick: (hint: string) => void;
};

export const ChatEmptyState = ({ onSuggestionClick }: Props) => (
  <Center axis="horizontal" style={{ maxWidth: 520, marginInline: 'auto', textAlign: 'center', paddingBlockStart: 'var(--spacing-6, 24px)' } as CSSProperties} padding={4}>
    <VStack gap={4} style={{ alignItems: 'center' } as CSSProperties}>
      <VStack gap={2} style={{ alignItems: 'center' } as CSSProperties}>
        <Heading level={3}>How can I help?</Heading>
        <Text type="supporting" color="secondary" style={{ textAlign: 'center' } as CSSProperties}>
          Ask anything — code, ideas, or quick questions. Math like <span dangerouslySetInnerHTML={{ __html: katex.renderToString('E=mc^2', { throwOnError: false }) }} /> renders inline.
        </Text>
      </VStack>
      <HStack gap={2} wrap="wrap" style={{ justifyContent: 'center' } as CSSProperties}>
        {suggestions.map((s) => (
          <Button key={s.label} label={s.label} variant="secondary" size="sm" icon={<Icon icon={s.icon} size="sm" />} onClick={() => onSuggestionClick(s.hint)} />
        ))}
      </HStack>
      <HStack gap={1} wrap="wrap" style={{ justifyContent: 'center', opacity: 0.85 } as CSSProperties}>
        <Token label="auth-service.ts" />
        <Token label="middleware.ts" />
        <Text type="supporting" color="secondary">try: “review these auth files”</Text>
      </HStack>
    </VStack>
  </Center>
);
