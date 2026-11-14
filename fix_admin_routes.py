import re

orig_path = r'C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace\backend\routes\productRoutes.js'
dest_path = r'C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace\backend\routes\adminRoutes.js'

with open(orig_path, 'r', encoding='utf-8') as f:
    orig = f.read()

with open(dest_path, 'r', encoding='utf-8') as f:
    dest = f.read()

# Extract exact strings from original productRoutes.js
def extract(pattern, text):
    m = re.search(pattern, text)
    return m.group(1) if m else None

# POST product validations
post_category = extract(r'body\("category"\)\.notEmpty\(\)\.withMessage\("([^"]+)"\)', orig)
post_images = extract(r'body\("images"\)\.isArray\(\{ min: 1 \}\)\.withMessage\("([^"]+)"\)', orig)
post_tags = extract(r'body\("tags"\)\.optional\(\{ nullable: true \}\)\.isArray\(\)\.withMessage\("([^"]+)"\)', orig)
post_discount = extract(r'body\("discountPrice"\)\.optional\(\{ nullable: true \}\)\.isNumeric\(\{ min: 0 \}\)\.withMessage\("([^"]+)"\)', orig)
post_stock = extract(r'body\("stock"\)\.isInt\(\{ min: 0 \}\)\.withMessage\("([^"]+)"\)', orig)

# PUT product validations
put_category = extract(r'body\("category"\)\.optional\(\{ nullable: true \}\)\.notEmpty\(\)\.withMessage\("([^"]+)"\)', orig)
put_images = extract(r'body\("images"\)\.optional\(\{ nullable: true \}\)\.isArray\(\{ min: 1 \}\)\.withMessage\("([^"]+)"\)', orig)
put_tags = extract(r'body\("tags"\)\.optional\(\{ nullable: true \}\)\.isArray\(\)\.withMessage\("([^"]+)"\)', orig)
put_discount = extract(r'body\("discountPrice"\)\.optional\(\{ nullable: true \}\)\.isNumeric\(\{ min: 0 \}\)\.withMessage\("([^"]+)"\)', orig)
put_stock = extract(r'body\("stock"\)\.optional\(\{ nullable: true \}\)\.isInt\(\{ min: 0 \}\)\.withMessage\("([^"]+)"\)', orig)

print("POST category:", post_category)
print("POST images:", post_images)
print("PUT category:", put_category)
print("PUT images:", put_images)

# Now fix dest - replace corrupted strings with correct ones
# Find corrupted patterns in dest and replace
# POST section
dest = re.sub(
    r'body\("category"\)\.notEmpty\(\)\.withMessage\("[^"]*"\),\n    body\("images"\)\.isArray\(\{ min: 1 \}\)\.withMessage\("[^"]*"\),\n    body\("tags"\)\.optional\(\{ nullable: true \}\)\.isArray\(\)\.withMessage\("[^"]*"\),',
    'body("category").notEmpty().withMessage("' + post_category + '"),\n    body("images").isArray({ min: 1 }).withMessage("' + post_images + '"),\n    body("tags").optional({ nullable: true }).isArray().withMessage("' + post_tags + '"),',
    dest
)
dest = re.sub(
    r'body\("discountPrice"\)\.optional\(\{ nullable: true \}\)\.isNumeric\(\{ min: 0 \}\)\.withMessage\("[^"]*"\),\n    body\("stock"\)\.isInt\(\{ min: 0 \}\)\.withMessage\("[^"]*"\),',
    'body("discountPrice").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("' + post_discount + '"),\n    body("stock").isInt({ min: 0 }).withMessage("' + post_stock + '"),',
    dest
)

# PUT section
dest = re.sub(
    r'body\("category"\)\.optional\(\{ nullable: true \}\)\.notEmpty\(\)\.withMessage\("[^"]*"\),\n    body\("images"\)\.optional\(\{ nullable: true \}\)\.isArray\(\{ min: 1 \}\)\.withMessage\("[^"]*"\),\n    body\("tags"\)\.optional\(\{ nullable: true \}\)\.isArray\(\)\.withMessage\("[^"]*"\),',
    'body("category").optional({ nullable: true }).notEmpty().withMessage("' + put_category + '"),\n    body("images").optional({ nullable: true }).isArray({ min: 1 }).withMessage("' + put_images + '"),\n    body("tags").optional({ nullable: true }).isArray().withMessage("' + put_tags + '"),',
    dest
)
dest = re.sub(
    r'body\("discountPrice"\)\.optional\(\{ nullable: true \}\)\.isNumeric\(\{ min: 0 \}\)\.withMessage\("[^"]*"\),\n    body\("stock"\)\.optional\(\{ nullable: true \}\)\.isInt\(\{ min: 0 \}\)\.withMessage\("[^"]*"\),',
    'body("discountPrice").optional({ nullable: true }).isNumeric({ min: 0 }).withMessage("' + put_discount + '"),\n    body("stock").optional({ nullable: true }).isInt({ min: 0 }).withMessage("' + put_stock + '"),',
    dest
)

with open(dest_path, 'w', encoding='utf-8') as f:
    f.write(dest)

print("Fixed adminRoutes.js")