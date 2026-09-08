'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { ChatComposer, ChatComposerInput } from '@astryxdesign/core/Chat';
import { SparklesIcon, Cog6ToothIcon, FolderIcon } from '@heroicons/react/24/outline';
import type { MuseStatus } from './types';
import type { ChatComposerTrigger } from '@astryxdesign/core/Chat';
import { getVsCodeApi } from '../vscode';

type Props = {
  museStatus: MuseStatus | null;
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: (v: string) => void;
  triggers: ChatComposerTrigger[];
};

export const MuseComposer = ({ museStatus, input, onInputChange, onSubmit, triggers }: Props) => (
  <ChatComposer
    onSubmit={onSubmit}
    placeholder="Ask anything — type / for commands"
    density="compact"
    input={<ChatComposerInput value={input} onChange={(e: unknown) => onInputChange(e as string)} onSubmit={onSubmit} triggers={triggers} maxRows={4} />}
    footerActions={
      museStatus ? (
        <>
          <DropdownMenu
            button={{
              label: museStatus.model ?? 'model',
              variant: 'ghost',
              size: 'sm',
              icon: <Icon icon={SparklesIcon} size="sm" />,
              isIconOnly: true,
            }}
            hasChevron={false}
            menuWidth={260}
            items={[
              { label: museStatus.model ?? 'spark-1.2-contributor', onClick: () => getVsCodeApi().postMessage({ type: 'send', text: '/model' }) },
              { label: 'Open model picker…', onClick: () => getVsCodeApi().postMessage({ type: 'send', text: '/model' }) },
            ]}
          />
          <DropdownMenu
            button={{
              label: `Settings — ${museStatus.effort ?? 'high'} • ${museStatus.approvalMode ?? 'on-request'}`,
              variant: 'ghost',
              size: 'sm',
              icon: <Icon icon={Cog6ToothIcon} size="sm" />,
              isIconOnly: true,
            }}
            hasChevron={false}
            menuWidth={240}
            items={[
              {
                type: 'section' as const,
                title: 'Reasoning effort',
                items: ['minimal', 'low', 'medium', 'high', 'xhigh', 'ultra'].map((e) => ({
                  label: e + (e === museStatus.effort ? ' • current' : ''),
                  onClick: () => getVsCodeApi().postMessage({ type: 'send', text: `/effort ${e}` }),
                })),
              },
              { type: 'divider' as const },
              {
                type: 'section' as const,
                title: 'Permissions',
                items: [
                  { label: `Mode: ${museStatus.approvalMode ?? 'on-request'}`, onClick: () => {} },
                  { label: `Sandbox: ${museStatus.sandbox ?? 'off'}`, onClick: () => {} },
                  { label: `Trust: ${museStatus.trust ?? 'trusted'}`, onClick: () => {} },
                  { label: 'Change via /approval-mode…', onClick: () => getVsCodeApi().postMessage({ type: 'send', text: '/approval-mode' }) },
                ],
              },
              { type: 'divider' as const },
              {
                type: 'section' as const,
                title: 'Workdir',
                items: [{ label: museStatus.workdir ?? '—', onClick: () => {} }],
              },
            ]}
          />
          <DropdownMenu
            button={{
              label: museStatus.workdir ?? 'workdir',
              variant: 'ghost',
              size: 'sm',
              icon: <Icon icon={FolderIcon} size="sm" />,
              isIconOnly: true,
            }}
            hasChevron={false}
            menuWidth={320}
            items={[{ label: museStatus.workdir ?? '—', onClick: () => {} }]}
          />
        </>
      ) : undefined
    }
  />
);
