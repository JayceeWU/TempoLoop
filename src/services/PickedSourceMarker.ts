import { z } from 'zod';

/**
 * Small recovery marker written before ImagePicker's cache file is moved.
 * The path is validated again against the Cache boundary before deletion.
 */
export const PickedSourceMarkerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pickerSourceUri: z.string().min(1),
});

export type PickedSourceMarkerFile = z.infer<typeof PickedSourceMarkerSchema>;
