'use client';

import type { CSSProperties } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Center } from '@astryxdesign/core/Center';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { useDialog } from '../../context/dialog-context';

type Props = {
  pendingUserInput?: {
    userInputId: string;
    sessionId: string;
    toolName?: string;
    questions: {
      id: string;
      header: string;
      question: string;
      selection?: { mode: string; maxSelections?: number };
      options?: { label: string; description?: string }[];
    }[];
  } | null;
  uiSelections?: Record<string, unknown>;
  setUiSelections?: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onClose?: () => void;
};

export const UserInputDialog = (props: Props) => {
  const ctx = useDialog();
  const pendingUserInput = props.pendingUserInput !== undefined ? props.pendingUserInput : ctx.pendingUserInput;
  const uiSelections = props.uiSelections ?? ctx.uiSelections;
  const setUiSelections = props.setUiSelections ?? ctx.setUiSelections;
  const onClose = props.onClose ?? ctx.cancelUserInput;
  const handleCancel = props.onClose ? () => { ctx.cancelUserInput(); props.onClose?.(); } : ctx.cancelUserInput;
  return (
  <Dialog isOpen={!!pendingUserInput} onOpenChange={(o) => !o && onClose()} purpose="info" variant="standard">
    {pendingUserInput && (
      <Layout
        header={
          <DialogHeader
            title={pendingUserInput.toolName ? `Input: ${pendingUserInput.toolName}` : 'Question'}
            subtitle={pendingUserInput.questions?.length ? `${pendingUserInput.questions.length} question(s)` : undefined}
            hasDivider
            onOpenChange={(o) => !o && onClose()}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              {pendingUserInput.questions?.map((q) => (
                <Card key={q.id} variant="muted" padding={3}>
                  <VStack gap={2}>
                    <Text type="label" weight="semibold" color="secondary" style={{ letterSpacing: 'var(--letter-spacing-wide, 0.04em)', textTransform: 'uppercase' } as CSSProperties}>
                      {q.header}
                    </Text>
                    <Text type="body" weight="medium">{q.question}</Text>
                    <VStack gap={1}>
                      {q.options?.map((opt) => {
                        const isSingle = q.selection?.mode === 'single';
                        const selected = uiSelections[q.id];
                        const isSelected = isSingle ? selected === opt.label : Array.isArray(selected) && (selected as string[]).includes(opt.label);
                        return (
                          <Card
                            key={opt.label}
                            variant={isSelected ? ('selected' as unknown as 'muted') : 'muted'}
                            padding={2}
                            style={{ cursor: 'pointer', borderColor: isSelected ? 'var(--color-border-strong)' : undefined } as CSSProperties}
                            onClick={() => {
                              if (isSingle) {
                                setUiSelections((prev) => ({ ...prev, [q.id]: opt.label }));
                              } else {
                                setUiSelections((prev) => {
                                  const cur: string[] = Array.isArray(prev[q.id]) ? (prev[q.id] as string[]) : [];
                                  const next = cur.includes(opt.label) ? cur.filter((x) => x !== opt.label) : [...cur, opt.label];
                                  const max = q.selection?.maxSelections;
                                  if (max && next.length > max) return prev;
                                  return { ...prev, [q.id]: next };
                                });
                              }
                            }}
                          >
                            <HStack gap={2} vAlign="center">
                              <Center
                                style={{
                                  width: 'var(--spacing-4, 16px)',
                                  height: 'var(--spacing-4, 16px)',
                                  borderRadius: isSingle ? 'var(--radius-full, 9999px)' : 'var(--radius-inner, 4px)',
                                  border: '1px solid var(--color-border)',
                                  background: isSelected ? 'var(--color-background-selected)' : 'transparent',
                                } as CSSProperties}
                              >
                                {isSelected && (
                                  <Center
                                    style={{
                                      width: 'var(--spacing-2, 8px)',
                                      height: 'var(--spacing-2, 8px)',
                                      borderRadius: isSingle ? 'var(--radius-full, 9999px)' : 'var(--radius-inner, 2px)',
                                      background: 'var(--color-foreground)',
                                    } as CSSProperties}
                                  >
                                    <span style={{ display: 'block', width: '100%', height: '100%' }} />
                                  </Center>
                                )}
                              </Center>
                              <VStack gap={0} style={{ flex: 1 } as CSSProperties}>
                                <Text type="label">{opt.label}</Text>
                                {opt.description && <Text type="supporting" color="secondary">{opt.description}</Text>}
                              </VStack>
                            </HStack>
                          </Card>
                        );
                      })}
                    </VStack>
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">Or free text (max 500)</Text>
                      <TextInput
                        label="Answer"
                        isLabelHidden
                        placeholder="Type answer…"
                        value={
                          typeof uiSelections[q.id] === 'string' &&
                          !(q.options ?? []).some((o) => o.label === uiSelections[q.id])
                            ? String(uiSelections[q.id])
                            : Array.isArray(uiSelections[q.id])
                              ? ''
                              : ''
                        }
                        onChange={(v: string) => setUiSelections((prev) => ({ ...prev, [q.id]: v }))}
                      />
                    </VStack>
                  </VStack>
                </Card>
              ))}
              <HStack gap={2} style={{ justifyContent: 'flex-end' } as CSSProperties}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                />
                <Button
                  label="Submit"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    if (!pendingUserInput) return;
                    const answers = pendingUserInput.questions.map((q) => {
                      const sel = uiSelections[q.id];
                      if (Array.isArray(sel)) return { questionId: q.id, selectedLabels: sel };
                      if (typeof sel === 'string' && (q.options ?? []).some((o) => o.label === sel)) return { questionId: q.id, selectedLabel: sel };
                      if (typeof sel === 'string' && sel.trim()) return { questionId: q.id, freeText: sel.slice(0, 500) };
                      if (q.selection?.mode === 'single' && q.options?.[0]) return { questionId: q.id, selectedLabel: q.options[0].label };
                      return { questionId: q.id, freeText: '' };
                    });
                    ctx.submitUserInput(answers as unknown[]);
                  }}
                />
              </HStack>
            </VStack>
          </LayoutContent>
        }
      />
    )}
  </Dialog>
  );
};
