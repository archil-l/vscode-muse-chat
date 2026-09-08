'use client';

import type { CSSProperties } from 'react';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Layout';
import { Text, Heading } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { DocumentTextIcon, ClipboardDocumentIcon, ShareIcon, XMarkIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { ARTIFACT_TITLE, ARTIFACT_SUBTITLE, ARTIFACT_CONTENT, artifactScroll, articleBody } from '../../lib/constants';
import { mathPlugins } from '../common/math-plugins';

export const ArtifactBody = () => (
  <VStack gap={2} style={{ ...artifactScroll, padding: 20, maxWidth: 720, marginInline: 'auto', overflowY: 'auto' } as CSSProperties}>
    <Heading level={1}>{ARTIFACT_TITLE}</Heading>
    <Text type="supporting" color="secondary">{ARTIFACT_SUBTITLE}</Text>
    <Markdown density="compact" inlinePlugins={mathPlugins as never}>{ARTIFACT_CONTENT}</Markdown>
  </VStack>
);

type ArtifactActionsProps = {
  onClose?: () => void;
};

export const ArtifactActions = ({ onClose }: ArtifactActionsProps) => (
  <>
    <DropdownMenu button={{ label: 'v2', variant: 'ghost', size: 'sm' }} items={[{ label: 'v2 (current)' }, { label: 'v1' }]} />
    <Button label="Copy" variant="ghost" size="sm" icon={<Icon icon={ClipboardDocumentIcon} size="sm" />} isIconOnly />
    <Button label="Share" variant="ghost" size="sm" icon={<Icon icon={ShareIcon} size="sm" />} isIconOnly />
    {onClose && <Button label="Close" variant="ghost" size="sm" icon={<Icon icon={XMarkIcon} size="sm" />} isIconOnly onClick={onClose} />}
  </>
);

type ArtifactCardProps = {
  onOpen: () => void;
};

export const ArtifactCard = ({ onOpen }: ArtifactCardProps) => (
  <Card variant="muted" padding={3} style={{ maxWidth: 380 } as CSSProperties}>
    <HStack gap={3} vAlign="center" width="100%">
      <Icon icon={DocumentTextIcon} size="md" color="secondary" />
      <StackItem size="fill">
        <VStack gap={0}>
          <Text type="label" weight="semibold">{ARTIFACT_TITLE}</Text>
          <Text type="supporting" color="secondary">Document</Text>
        </VStack>
      </StackItem>
      <Button label="Open" variant="ghost" size="sm" icon={<Icon icon={ChevronRightIcon} size="sm" color="secondary" />} isIconOnly onClick={onOpen} />
    </HStack>
  </Card>
);
