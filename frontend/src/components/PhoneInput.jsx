import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { parsePhoneNumberFromString, isValidPhoneNumber } from "libphonenumber-js";
import "./PhoneInput.css";

const COUNTRY_OPTIONS = [
  { code: "TH", label: "🇹🇭 Thailand (+66)", dialCode: "+66", prefix: "66" },
  { code: "MM", label: "🇲🇲 Myanmar (+95)", dialCode: "+95", prefix: "95" },
];

function detectCountryPrefix(raw) {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\+?(66|95)(.*)$/);
  if (!m) return null;
  const prefix = m[1];
  const rest = m[2].replace(/[^\d]/g, "");
  const opt = COUNTRY_OPTIONS.find((o) => o.prefix === prefix);
  if (!opt) return null;
  return { code: opt.code, rest };
}

export default function PhoneInput({
  value,
  onChange,
  placeholder = "08X-XXX-XXXX",
  required = false,
  disabled = false,
  error = "",
  label = "เบอร์โทรศัพท์",
}) {
  const [selectedCountry, setSelectedCountry] = useState("TH");
  const [nationalNumber, setNationalNumber] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [focusedOptionIndex, setFocusedOptionIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef(null);
  const selectorRef = useRef(null);
  const lastEmittedRef = useRef("");

  useEffect(() => {
    if (!value) {
      if (nationalNumber) setNationalNumber("");
      return;
    }
    if (value === lastEmittedRef.current) return;
    const parsed = parsePhoneNumberFromString(value);
    if (parsed && parsed.country && COUNTRY_OPTIONS.some((o) => o.code === parsed.country)) {
      setSelectedCountry(parsed.country);
      setNationalNumber(parsed.nationalNumber || "");
      return;
    }
    const digits = value.replace(/[^\d]/g, "");
    setNationalNumber(digits);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const isOutsideContainer = containerRef.current && !containerRef.current.contains(event.target);
      const dropdown = document.querySelector(".country-dropdown");
      const isOutsideDropdown = dropdown && !dropdown.contains(event.target);
      if (isOutsideContainer && isOutsideDropdown) {
        setShowDropdown(false);
        setFocusedOptionIndex(-1);
      }
    };
    if (showDropdown) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  const updateDropdownPosition = useCallback(() => {
    if (selectorRef.current) {
      const rect = selectorRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, []);

  const handleSelectorClick = useCallback(() => {
    if (!disabled) {
      setShowDropdown((prev) => {
        const next = !prev;
        if (next) setTimeout(updateDropdownPosition, 0);
        return next;
      });
      setFocusedOptionIndex(-1);
    }
  }, [disabled, updateDropdownPosition]);

  const emit = useCallback((countryCode, number) => {
    const opt = COUNTRY_OPTIONS.find((o) => o.code === countryCode);
    if (!opt) return;
    const fullNumber = number ? `${opt.dialCode}${number}` : "";
    let out = fullNumber;
    if (number) {
      const parsed = parsePhoneNumberFromString(fullNumber, countryCode);
      if (parsed) out = parsed.format("E.164");
    }
    lastEmittedRef.current = out;
    onChange(out);
  }, [onChange]);

  const handleInputChange = (e) => {
    const raw = e.target.value;
    const digits = raw.replace(/[^\d+]/g, "");
    const detected = detectCountryPrefix(digits);
    if (detected) {
      setSelectedCountry(detected.code);
      setNationalNumber(detected.rest);
      emit(detected.code, detected.rest);
    } else {
      const clean = digits.replace(/[^\d]/g, "");
      setNationalNumber(clean);
      emit(selectedCountry, clean);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text").trim();
    if (!pastedText) return;
    const digits = pastedText.replace(/[^\d+]/g, "");
    const detected = detectCountryPrefix(digits);
    if (detected) {
      setSelectedCountry(detected.code);
      setNationalNumber(detected.rest);
      emit(detected.code, detected.rest);
    } else {
      const clean = digits.replace(/[^\d]/g, "");
      setNationalNumber(clean);
      emit(selectedCountry, clean);
    }
  };

  const handleCountryChange = (countryCode) => {
    setSelectedCountry(countryCode);
    setShowDropdown(false);
    setFocusedOptionIndex(-1);
    selectorRef.current?.focus();
    emit(countryCode, nationalNumber);
  };

  const handleSelectorKeyDown = (e) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        setShowDropdown((prev) => !prev);
        setFocusedOptionIndex(showDropdown ? -1 : 0);
        break;
      case "Escape":
        setShowDropdown(false);
        setFocusedOptionIndex(-1);
        break;
      case "ArrowDown":
        if (showDropdown) {
          e.preventDefault();
          setFocusedOptionIndex((prev) => Math.min(prev + 1, COUNTRY_OPTIONS.length - 1));
        }
        break;
      case "ArrowUp":
        if (showDropdown) {
          e.preventDefault();
          setFocusedOptionIndex((prev) => Math.max(prev - 1, 0));
        }
        break;
      case "Tab":
        setShowDropdown(false);
        setFocusedOptionIndex(-1);
        break;
    }
  };

  const handleOptionKeyDown = (e, index) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        handleCountryChange(COUNTRY_OPTIONS[index].code);
        break;
      case "Escape":
        setShowDropdown(false);
        setFocusedOptionIndex(-1);
        selectorRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        setFocusedOptionIndex((prev) => Math.min(prev + 1, COUNTRY_OPTIONS.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedOptionIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Tab":
        setShowDropdown(false);
        setFocusedOptionIndex(-1);
        break;
    }
  };

  const isValid = () => {
    if (!nationalNumber) return false;
    const opt = COUNTRY_OPTIONS.find((o) => o.code === selectedCountry);
    if (!opt) return false;
    const fullNumber = `${opt.dialCode}${nationalNumber}`;
    return isValidPhoneNumber(fullNumber, selectedCountry);
  };

  return (
    <div className="phone-input-wrapper" ref={containerRef}>
      <label className="form-label" htmlFor="phone-input">
        {label} {required && <span className="required">*</span>}
      </label>
      <div className="phone-input-container">
        <button
          ref={selectorRef}
          type="button"
          className="country-selector"
          onClick={handleSelectorClick}
          onKeyDown={handleSelectorKeyDown}
          aria-haspopup="listbox"
          aria-expanded={showDropdown}
          aria-label="Select country code"
          disabled={disabled}
        >
          <span className="country-flag" aria-hidden="true">
            {COUNTRY_OPTIONS.find((opt) => opt.code === selectedCountry)?.label.split(" ")[0]}
          </span>
          <span className="country-dial-code">
            {COUNTRY_OPTIONS.find((opt) => opt.code === selectedCountry)?.dialCode}
          </span>
          <svg className="dropdown-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <input
          id="phone-input"
          type="tel"
          className={`phone-input ${error ? "has-error" : ""} ${!isValid() && nationalNumber ? "invalid" : ""}`}
          value={nationalNumber}
          onChange={handleInputChange}
          onPaste={handlePaste}
          onBlur={() => setShowDropdown(false)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete="tel"
        />
      </div>
      {showDropdown && createPortal(
        <div
          className="country-dropdown"
          role="listbox"
          aria-label="Country selection"
          style={{
            position: "fixed",
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            zIndex: 9999,
          }}
        >
          {COUNTRY_OPTIONS.map((opt, index) => (
            <button
              key={opt.code}
              type="button"
              role="option"
              className={`country-option ${selectedCountry === opt.code ? "selected" : ""} ${focusedOptionIndex === index ? "focused" : ""}`}
              onClick={() => handleCountryChange(opt.code)}
              onKeyDown={(e) => handleOptionKeyDown(e, index)}
              aria-selected={selectedCountry === opt.code}
              aria-current={selectedCountry === opt.code ? "true" : "false"}
              tabIndex={showDropdown ? 0 : -1}
            >
              <span>{opt.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
      {error && <span className="error-message">{error}</span>}
    </div>
  );
}
