import { createPortal } from 'react-dom';
import { useBranding } from '@/client/contexts/BrandingContext';
import { orderSheetInnerHtml, type SheetPrintModel } from '@/client/lib/orderSheetLayout';

export type { SheetPrintModel } from '@/client/lib/orderSheetLayout';

export function OrderSheetPrint({ model }: { model: SheetPrintModel }) {
  const { settings } = useBranding();
  return createPortal(
    <section
      className="order-print"
      dir="rtl"
      dangerouslySetInnerHTML={{
        __html: orderSheetInnerHtml(model, { companyName: settings.companyName, logoUrl: settings.logoUrl }),
      }}
    />,
    document.body
  );
}
