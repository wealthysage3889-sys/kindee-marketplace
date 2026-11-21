p='frontend/src/pages/Checkout.jsx'
s=open(p,encoding='utf-8').read()

marker='                </div>\n              </label>\n              \n              <label className={`payment-option ${paymentMethod === "promptpay"'
kbz='''                </div>
              </label>

              <label className={`payment-option ${paymentMethod === "kbzpay" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="kbzpay"
                  checked={paymentMethod === "kbzpay"}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <div className="payment-option-content">
                  <span className="payment-icon">KBZ</span>
                  <div>
                    <strong>KBZPay Wallet (Myanmar)</strong>
                    <p>Pay in MMK using live THB to MMK rate</p>
                  </div>
                </div>
              </label>'''
assert marker in s, "marker not found"
s=s.replace(marker, kbz, 1)

old='''    try {
      // Prepare order items with store info'''
new='''    if (paymentMethod === "kbzpay" && !exchangeRate) {
      setError("Unable to fetch exchange rate. Please retry or choose COD.");
      setLoading(false);
      return;
    }
    try {
      // Prepare order items with store info'''
assert old in s
s=s.replace(old,new,1)

old2='''        paymentMethod,
        customerNotes,'''
new2='''        paymentMethod,
        exchangeRate: paymentMethod === "kbzpay" ? exchangeRate : null,
        exchangeRateSource: paymentMethod === "kbzpay" ? "open.er-api.com" : null,
        exchangeRateUpdatedAt: paymentMethod === "kbzpay" ? rateUpdatedAt : null,
        amountMMK: paymentMethod === "kbzpay" and exchangeRate and (round(totalAmount * exchangeRate,2)) or None,
        customerNotes,'''
# python syntax not in string? fix below
new2=new2.replace('paymentMethod === "kbzpay" and exchangeRate and (round(totalAmount * exchangeRate,2)) or None','paymentMethod === "kbzpay" ? Math.round(totalAmount * exchangeRate * 100) / 100 : null')
assert old2 in s
s=s.replace(old2,new2,1)

open(p,'w',encoding='utf-8').write(s)
print("done")
