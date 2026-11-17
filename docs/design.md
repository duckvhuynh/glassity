# glassity v0.1 — thiết kế

Ngày 17/11/2026. Ghi lại các quyết định thiết kế của bản 0.1.

## Mục đích

Biến icon SVG có sẵn (Lucide hoặc bất kỳ SVG nào) thành kính kiểu Liquid Glass mà không vẽ lại icon. Ưu tiên theo thứ tự: **dễ dùng → đẹp → props đầy đủ**. "Nhẹ" đã được bỏ khỏi yêu cầu.

## Mục tiêu

- Bật một lần cho cả app hoặc một vùng: `<GlassProvider>` (React) hoặc `import 'glassity/auto'` (vanilla). Icon có `data-glass` tự thành kính.
- Chỉnh riêng một icon: `<Glass …props>` hoặc `data-glass-*`.
- Khúc xạ thật, giống nhau trên Chrome, Safari, Firefox.
- Mọi prop đều có mặc định; kích thước lấy từ SVG.

## Không làm trong v0.1

- Các icon gần nhau tự dính vào nhau (kiểu `GlassEffectContainer`).
- Icon nhiều lớp (background + foreground layers).
- Nhúng web font vào ảnh chụp nền.

## Điều sẽ coi là thất bại

- Người dùng phải tự tạo canvas nền hoặc tự tính toạ độ.
- Icon mất khả năng truy cập (tên, focus, click) sau khi thành kính.
- Icon biến mất khi máy không có WebGL2.

## Các hướng đã cân nhắc

| Hướng | Được | Mất | Kết quả |
|---|---|---|---|
| Renderer CPU của prototype | Đã có sẵn | 10–30 ms mỗi icon, phải tự đưa canvas nền | Bỏ |
| SVG filter + `backdrop-filter` | Rất nhẹ, bẻ được nội dung sống | Chỉ Chromium bẻ được nền; hiệu ứng bị giới hạn bởi filter primitive | Bỏ sau khi người dùng bỏ yêu cầu "nhẹ" |
| **WebGL2** | Tán sắc nhiều dải, morph, tự thích ứng theo nền, giống nhau mọi trình duyệt | Phải có ảnh nền; nặng hơn | **Chọn** |

## Kiến trúc

```
SVG → raster alpha → trường khoảng cách có dấu + độ dày cục bộ  (CPU, một lần, có cache)
                         ↓ texture RG16F
backdrop (tự dò / chụp / khai báo) → texture RGBA có mipmap
                         ↓
một WebGL2 context dùng chung → vẽ từng icon → chép ra canvas 2D của icon đó
```

- **Một WebGL context cho cả trang.** Mỗi icon có một canvas 2D nhỏ nằm đè lên SVG gốc, nên icon vẫn đúng lớp trong trang.
- **Hình lưu dưới dạng trường khoảng cách.** `bevel`, `curvature`, `profile` tính trong shader, đổi không phải dựng lại. Morph = trộn hai trường.
- **Độ dày cục bộ** để nét mảnh ra tiết diện ống tròn, còn mảng lớn có đỉnh phẳng.
- **SVG gốc giữ nguyên trong DOM** (opacity 0 sau khi kính vẽ xong lần đầu) để giữ accessibility và click.

## Nền (backdrop)

`backdrop="auto"` (mặc định):
Tìm tổ tiên gần nhất có vẽ nền ("bề mặt" mà icon nằm trên):
1. Bề mặt có `background-image` (ảnh hoặc gradient) → chụp riêng nền CSS đó.
2. Bề mặt chỉ có màu nền → chụp nội dung HTML của nó (tối đa 1500 node), chụp lại khi nội dung đổi.
3. Không tìm thấy bề mặt nào → chụp vùng chứa của provider, hoặc `<body>`.
4. Quá giới hạn hoặc lỗi → nền CSS hoặc màu nền trang.

Khai báo tay: URL ảnh, `<img>`, `<video>`, `<canvas>`, hoặc một element bất kỳ.

## Quang học (shader)

- Profile: `squircle` (mặc định), `circle`, `lip`.
- Khúc xạ bằng `refract()` theo Snell với `ior`, cộng `depth`.
- Tán sắc: `bands` dải bước sóng (mặc định 6), mỗi dải một IOR.
- Frost: lấy mẫu mipmap của nền, 4 tap.
- Ánh sáng: specular Blinn-Phong, rim hai phía, phản chiếu môi trường theo Fresnel, nhiễu dọc mép.
- Tự lật sáng/tối: đo độ sáng nền ngay dưới icon.
- Materialize: tăng giảm độ bẻ sáng, không fade đơn thuần.

## Biến thể

- `regular`: frost, tăng bão hoà, giảm tương phản nền, tint nhẹ.
- `clear`: không frost; `dim: 'auto'` phủ tối tới 35% khi nền sáng và nhiều chi tiết (ảnh), không phủ trên nền trắng trơn.
- `identity`: không áp kính.

## Accessibility

- `prefers-reduced-motion`: tắt ánh sáng theo con trỏ, tắt nảy, chuyển cảnh tức thì.
- `prefers-reduced-transparency`: frost và tint tăng mạnh.
- `prefers-contrast: more`: đen/trắng đặc.
- `forced-colors`: không áp kính.

## Các quyết định do người viết tự chốt

- TypeScript, build bằng tsup, chỉ ESM + một bản IIFE cho thẻ `<script>`.
- React là peer tuỳ chọn; lõi không phụ thuộc gì.
- Test đơn vị cho phần hình học thuần; phần WebGL kiểm bằng trang demo trong trình duyệt.
