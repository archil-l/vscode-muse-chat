'use client';

import type { CSSProperties } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { getVsCodeApi } from '../../vscode';

type Props = {
  pendingApproval: {
    approvalId: string;
    sessionId: string;
    toolName?: string;
    subject?: { kind?: string; command?: string; path?: string; target?: string; host?: string; port?: string | number };
    choices?: { choiceId: string; label: string; decision?: string }[];
  } | null;
  onClose: () => void;
};

export const ApprovalDialog = ({ pendingApproval, onClose }: Props) => (
  <Dialog isOpen={!!pendingApproval} onOpenChange={(o) => !o && onClose()} purpose="info" variant="default">
    {pendingApproval && (
      <Layout
        header={
          <DialogHeader
            title={`Approval: ${pendingApproval.toolName ?? 'tool'}`}
            subtitle={pendingApproval.subject?.kind ? `${pendingApproval.subject.kind}${pendingApproval.subject.command ? ` — ${pendingApproval.subject.command.slice(0, 80)}` : ''}` : undefined}
            hasDivider
            onOpenChange={(o) => !o && onClose()}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={3}>
              {pendingApproval.subject && (
                <Card variant="muted" padding={3}>
                  <VStack gap={1}>
                    {pendingApproval.subject.command && <Text type="body" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-caption, 11px)', whiteSpace: 'pre-wrap' } as CSSProperties}>{pendingApproval.subject.command}</Text>}
                    {pendingApproval.subject.path && <Text type="supporting" color="secondary">Path: {pendingApproval.subject.path}</Text>}
                    {pendingApproval.subject.target && <Text type="supporting" color="secondary">Target: {pendingApproval.subject.target}</Text>}
                    {pendingApproval.subject.host && <Text type="supporting" color="secondary">Host: {pendingApproval.subject.host}{pendingApproval.subject.port ? `:${pendingApproval.subject.port}` : ''}</Text>}
                  </VStack>
                </Card>
              )}
              <VStack gap={2}>
                {pendingApproval.choices?.map((c) => (
                  <Button
                    key={c.choiceId}
                    label={c.label}
                    variant={c.decision === 'allow' ? ('primary' as unknown as 'secondary') : 'secondary'}
                    size="sm"
                    onClick={() => {
                      getVsCodeApi().postMessage({ type: 'approval_decide', approvalId: pendingApproval.approvalId, choiceId: c.choiceId, sessionId: pendingApproval.sessionId });
                      onClose();
                    }}
                  />
                ))}
                {!pendingApproval.choices?.length && <Text type="supporting" color="secondary">No choices</Text>}
              </VStack>
              <Button label="Dismiss" variant="ghost" size="sm" onClick={onClose} />
            </VStack>
          </LayoutContent>
        }
      />
    )}
  </Dialog>
);
