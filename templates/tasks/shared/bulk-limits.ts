/**
 * Max ids accepted by a single bulk or reorder action.
 *
 * Reorder actions require every visible id, so this also caps the size of a
 * list that can be reordered or select-all'd in one call.
 */
export const BULK_ID_LIMIT = 500;
