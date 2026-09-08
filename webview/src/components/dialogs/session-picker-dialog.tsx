'use client';

import type { CSSProperties } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { getVsCodeApi } from '../../vscode';

type Session = {
  sessionId: string;
  title?: string;
  updatedAt?: number;
  workspaceRoot?: string;
};

type Props = {
  sessions: Session[] | null;
  onClose: () => void;
};

export const SessionPickerDialog = ({ sessions, onClose }: Props) => (
  <Dialog isOpen={!!sessions} onOpenChange={(o) => !o && onClose()} purpose="info" variant="default">
    <Layout
      header={<DialogHeader title="Resume session" subtitle={`${sessions?.length ?? 0} recent sessions`} hasDivider onOpenChange={(o) => !o && onClose()} />}
      content={
        <LayoutContent padding={4}>
          <VStack gap={2}>
            {sessions?.length === 0 && <Text type="supporting" color="secondary">No sessions</Text>}
            {sessions?.map((s) => (
              <Card
                key={s.sessionId}
                variant="muted"
                padding={3}
                style={{ cursor: 'pointer' } as CSSProperties}
                onClick={() => {
                  getVsCodeApi().postMessage({ type: 'session_pick', sessionId: s.sessionId });
                  onClose();
                }}
              >
                <VStack gap={1}>
                  <Text type="label" weight="semibold" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as CSSProperties}>
                    {s.title || 'Untitled'}
                  </Text>
                  <Text type="supporting" color="secondary" style={{ fontSize: 'var(--font-size-caption, 11px)' } as CSSProperties}>
                    {s.sessionId?.slice(0, 8)} · {s.workspaceRoot ?? ''}{' '}
                    {s.updatedAt ? `· ${new Date(Number(String(s.updatedAt).length > 10 ? s.updatedAt / 1000 : s.updatedAt * 1000)).toLocaleString()}` : ''}
                  </Text>
                </VStack>
              </Card>
            ))}
            <Button label="Cancel" variant="ghost" size="sm" onClick={onClose} />
          </VStack>
        </LayoutContent>
      }
    />
  </Dialog>
);
