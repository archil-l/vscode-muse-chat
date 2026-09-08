'use client';

import type { CSSProperties } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { ClockIcon, PencilSquareIcon } from '@heroicons/react/24/outline';

const headerStyle: CSSProperties = {
  height: 'var(--spacing-9, 36px)',
  minHeight: 'var(--spacing-9, 36px)',
  borderBottom: '1px solid var(--vscode-sideBarSectionHeader-border, var(--color-border))',
  background: 'var(--vscode-sideBar-background, var(--color-background))',
  color: 'var(--vscode-foreground, var(--color-foreground))',
};

type Props = {
  title: string;
  onHistory: () => void;
  onNewConversation: () => void;
};

export const MuseHeader = ({ title, onHistory, onNewConversation }: Props) => (
  <HStack gap={2} style={headerStyle} hAlign="between" vAlign="center" paddingInline={3}>
    <HStack gap={2} vAlign="center" style={{ flex: 1, minWidth: 0 } as CSSProperties}>
      <StatusDot variant="success" label="connected" />
      <Text type="label" weight="semibold" maxLines={1} style={{ letterSpacing: 'var(--spacing-px, 0.015em)', opacity: 0.92 } as CSSProperties} title={title}>
        {title.length > 48 ? `${title.slice(0, 47)}…` : title}
      </Text>
    </HStack>
    <HStack gap={1} vAlign="center">
      <IconButton label="History" icon={<Icon icon={ClockIcon} size="sm" />} variant="ghost" size="sm" tooltip="History" onClick={onHistory} />
      <IconButton label="New conversation" icon={<Icon icon={PencilSquareIcon} size="sm" />} variant="ghost" size="sm" tooltip="New conversation" onClick={onNewConversation} />
    </HStack>
  </HStack>
);
