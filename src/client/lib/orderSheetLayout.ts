import type { ClientOrderDetailDTO, DailySheetDetailDTO, OrderItemDetailDTO } from '@/shared/types';

export interface SheetPrintModel {
  sheet: DailySheetDetailDTO;
  orders: ClientOrderDetailDTO[];
}

export const ORDER_SHEET_COLUMNS = 13;

const CELL =
  'border:1px solid #000;text-align:center;vertical-align:middle;padding:3px 4px;font-size:10px;font-family:Cairo,Tahoma,sans-serif;line-height:1.35;box-sizing:border-box;';

function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function packingPrintValue(item: OrderItemDetailDTO): string {
  if (item.orderMode === 'kg') return 'كجم';
  if (item.orderMode === 'piece') return 'قطعة';
  return String(item.packingCapacitySnapshot);
}

export function cartonsPrintValue(item: OrderItemDetailDTO): number {
  if (item.orderMode === 'piece' || item.orderMode === 'kg') return 0;
  return item.cartonsQty;
}

export function weightNotesValue(item: OrderItemDetailDTO): string {
  const parts: string[] = [];
  if (item.orderMode === 'kg' && item.weightKg > 0) parts.push(`${item.weightKg} كجم`);
  if (item.notes) parts.push(item.notes);
  return parts.join(' - ');
}

const PHONE =
  "white-space:nowrap;direction:ltr;display:inline-block;font-size:9px;word-break:normal;overflow-wrap:normal;mso-number-format:'\\@';";

function phoneHtml(value: string | number | null | undefined): string {
  return `<span class="print-phone" style="${PHONE}">${esc(value)}</span>`;
}

function partyHtml(order: ClientOrderDetailDTO): string {
  if (order.deliveryType === 'sub_merchant') {
    return `<div>${esc(order.subMerchantName)}</div><div>${phoneHtml(order.subMerchantPhone)}</div>`;
  }
  return phoneHtml(order.deliveryPhone);
}

export function orderSheetInnerHtml(model: SheetPrintModel): string {
  const orders = model.orders ?? [];
  const body = orders
    .map((order, orderIndex) => {
      const items = order.items ?? [];
      const span = items.length;
      const rows = items
        .map((item, itemIndex) => {
          const lead =
            itemIndex === 0
              ? `<td rowspan="${span}" style="${CELL}">${orderIndex + 1}</td>
                 <td rowspan="${span}" style="${CELL}"><div>${esc(order.customerName)}</div><div>${esc(order.customerCode)}</div></td>
                 <td rowspan="${span}" style="${CELL}">${esc(order.deliveryLocation)}</td>
                 <td rowspan="${span}" style="${CELL}">${esc(order.trucksCount || 1)}</td>
                 <td rowspan="${span}" style="${CELL}">${esc(order.representativeName)}</td>`
              : '';
          const tail =
            itemIndex === 0
              ? `<td rowspan="${span}" style="${CELL}">${esc(order.warehouseRef)}</td>
                 <td rowspan="${span}" class="td-party" x:str style="${CELL}word-break:normal;overflow-wrap:normal;mso-number-format:'\\@';">${partyHtml(order)}</td>`
              : '';
          return `<tr>
            ${lead}
            <td style="${CELL}">${esc(item.productCode)}</td>
            <td style="${CELL}">${esc(item.productName)}</td>
            <td style="${CELL}">${esc(packingPrintValue(item))}</td>
            <td style="${CELL}">${cartonsPrintValue(item)}</td>
            <td style="${CELL}">${esc(item.totalPieces)}</td>
            <td style="${CELL}">${esc(weightNotesValue(item))}</td>
            ${tail}
          </tr>`;
        })
        .join('');
      if (!rows) return '';
      const spacer =
        orderIndex < orders.length - 1
          ? `<tr class="spacer-row"><td colspan="${ORDER_SHEET_COLUMNS}" style="height:12px;border:none;padding:0;background:#fff;"></td></tr>`
          : '';
      return `<tbody class="client-order-block" style="break-inside:avoid;page-break-inside:avoid;">${rows}${spacer}</tbody>`;
    })
    .join('');

  return `
    <link rel="stylesheet" href="/fonts/cairo.css" />
    <div class="order-print-banner" style="display:flex;justify-content:space-between;border:1px solid #000;padding:6px 10px;margin-bottom:6px;font-size:14px;font-weight:700;font-family:Cairo,Tahoma,sans-serif;">
      <strong>${esc(model.sheet.sheetDate)}</strong>
      <strong>ORDERS NO ${esc(model.sheet.sheetNumber)}</strong>
    </div>
    <table dir="rtl" style="width:733px;max-width:100%;border-collapse:collapse;table-layout:fixed;direction:rtl;">
      <colgroup>
        <col class="c-serial" width="22" style="width:22px" />
        <col class="c-customer" width="88" style="width:88px" />
        <col class="c-place" width="81" style="width:81px" />
        <col class="c-trucks" width="42" style="width:42px" />
        <col class="c-rep" width="59" style="width:59px" />
        <col class="c-code" width="53" style="width:53px" />
        <col class="c-product" width="90" style="width:90px" />
        <col class="c-pack" width="32" style="width:32px" />
        <col class="c-cartons" width="38" style="width:38px" />
        <col class="c-pieces" width="40" style="width:40px" />
        <col class="c-weight" width="81" style="width:81px" />
        <col class="c-blank" width="32" style="width:32px" />
        <col class="c-party" width="75" style="width:75px" />
      </colgroup>
      <thead style="display:table-header-group;">
        <tr>
          <th style="${CELL}width:22px;">م</th>
          <th style="${CELL}">العميل</th>
          <th style="${CELL}">المكان</th>
          <th class="th-trucks" style="${CELL}width:42px;font-size:8.5px;word-break:normal;overflow-wrap:normal;line-height:1.15;padding:2px 1px;">عدد السيارات</th>
          <th style="${CELL}">المندوب</th>
          <th style="${CELL}">كود الصنف</th>
          <th style="${CELL}">الصنف</th>
          <th style="${CELL}width:32px;font-size:8.5px;word-break:normal;overflow-wrap:normal;line-height:1.15;padding:2px 1px;">التعبئة</th>
          <th style="${CELL}width:38px;font-size:8.5px;word-break:normal;overflow-wrap:normal;line-height:1.15;padding:2px 1px;">عدد الكراتين</th>
          <th style="${CELL}width:40px;font-size:8.5px;word-break:normal;overflow-wrap:normal;line-height:1.15;padding:2px 1px;">عدد القطع</th>
          <th style="${CELL}">الوزن (كجم) / ملاحظات</th>
          <th style="${CELL}width:32px;"></th>
          <th style="${CELL}width:75px;"></th>
        </tr>
      </thead>
      ${body}
      <tbody class="print-signs" style="break-inside:avoid;page-break-inside:avoid;">
        <tr>
          <td colspan="4" style="${CELL}height:48px;font-size:12px;font-weight:700;">مدير المبيعات</td>
          <td colspan="5" style="${CELL}height:48px;font-size:12px;font-weight:700;">الاداره المالية</td>
          <td colspan="4" style="${CELL}height:48px;font-size:12px;font-weight:700;">ادارة الانتاج</td>
        </tr>
      </tbody>
    </table>`;
}
