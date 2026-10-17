import type { Dish } from '../../../../shared/types';
import { ShoppingPreview } from '../../components/ShoppingBits';
import { Sheet } from '../../components/Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  dishIds: readonly string[];
  dishes: readonly Dish[];
}

/** Read-only preview from the selected dishes; statuses and manual items need a saved meal. */
export function ShoppingPreviewSheet({ open, onClose, dishIds, dishes }: Props) {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const selected = dishIds.flatMap((id) => {
    const d = byId.get(id);
    return d ? [d] : [];
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="采购清单预览"
      variant="drawer"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          知道了
        </button>
      }
    >
      <ShoppingPreview dishes={selected} unavailable={dishIds.length - selected.length} />
    </Sheet>
  );
}
