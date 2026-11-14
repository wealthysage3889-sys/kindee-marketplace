path = r'C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace\frontend\src\api\auth.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace corrupted error message with correct Thai
content = content.replace(
    'เกิดข้อผิดehler',
    'เกิดข้อผิด'
)
content = content.replace(
    'เกิดข้อผิด',
    'เกิดข้อผิด'
)

# The correct message should be: เกิดข้อผิด
# Let me just set it to a clean ASCII-safe version to avoid corruption
content = content.replace(
    'const err = new Error(data.message || "เกิดข้อผิด");',
    'const err = new Error(data.message || "เกิดข้อผิด");'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("done")