import { createPortal } from 'react-dom';
import { orderSheetInnerHtml, type SheetPrintModel } from '@/client/lib/orderSheetLayout';

export type { SheetPrintModel } from '@/client/lib/orderSheetLayout';

export function OrderSheetPrint({ model }: { model: SheetPrintModel }) {
  return createPortal(
    <section
      className="order-print"
      dir="rtl"
      dangerouslySetInnerHTML={{ __html: orderSheetInnerHtml(model) }}
    />,
    document.body
  );
}
