p='frontend/src/pages/Checkout.jsx'
s=open(p,encoding='utf-8').read()
s=s.replace(
'  const [paymentMethod, setPaymentMethod] = useState("cod");',
'  const [paymentMethod, setPaymentMethod] = useState("cod");\n  const [exchangeRate, setExchangeRate] = useState(null);\n  const [rateUpdatedAt, setRateUpdatedAt] = useState(null);\n  const [rateLoading, setRateLoading] = useState(false);\n  const [rateError, setRateError] = useState("");'
)
anchor='  const handlePaymentSubmit = (e) => {\n    e.preventDefault();\n    setStep(3);\n  };'
effect='''  useEffect(() => {
    if (paymentMethod !== "kbzpay") return;
    let cancelled = false;
    const fetchRate = async () => {
      setRateLoading(true);
      setRateError("");
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/THB");
        if (!res.ok) throw new Error("rate fetch failed");
        const data = await res.json();
        if (!data || data.result !== "success" || !data.rates || !data.rates.MMK) {
          throw new Error("invalid rate response");
        }
        if (cancelled) return;
        setExchangeRate(Number(data.rates.MMK));
        setRateUpdatedAt(data.time_last_update_utc || new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        setExchangeRate(null);
        setRateUpdatedAt(null);
        setRateError("Unable to fetch THB to MMK exchange rate. Please retry or choose another method.");
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    };
    fetchRate();
    return () => { cancelled = true; };
  }, [paymentMethod]);

'''
s=s.replace(anchor, effect+anchor)
open(p,'w',encoding='utf-8').write(s)
print("done")
