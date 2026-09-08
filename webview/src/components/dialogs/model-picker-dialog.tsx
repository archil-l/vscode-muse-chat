'use client';

import type { CSSProperties } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { useDialog } from '../../context/dialog-context';

type Props = {
  models?: unknown[] | null;
  onClose?: () => void;
};

export const ModelPickerDialog = (props: Props) => {
  const ctx = useDialog();
  const models = props.models !== undefined ? props.models : ctx.models;
  const onClose = props.onClose ?? ctx.closeModelPicker;
  return (
  <Dialog isOpen={!!models} onOpenChange={(o) => !o && onClose()} purpose="info" variant="standard">
    <Layout
      header={<DialogHeader title="Select model" subtitle={`${models?.length ?? 0} models`} hasDivider onOpenChange={(o) => !o && onClose()} />}
      content={
        <LayoutContent padding={4}>
          <VStack gap={2}>
            {(models ?? []).map((m: unknown) => {
              const rec = m as Record<string, unknown>;
              const id = String(rec.id ?? rec.modelId ?? rec.model_id ?? String(m));
              const label = String(rec.displayName ?? rec.label ?? id);
              return (
                <Card
                  key={id}
                  variant="muted"
                  padding={3}
                  style={{ cursor: 'pointer' } as CSSProperties}
                  onClick={() => ctx.pickModel(id)}
                >
                  <VStack gap={0}>
                    <Text type="label" weight="semibold">{label}</Text>
                    <Text type="supporting" color="secondary">{id}</Text>
                  </VStack>
                </Card>
              );
            })}
            <Button label="Cancel" variant="ghost" size="sm" onClick={onClose} />
          </VStack>
        </LayoutContent>
      }
    />
  </Dialog>
  );
};
