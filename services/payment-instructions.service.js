const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS', 'EUR'];

function tokensFrom(str) {
  return str.split(' ').filter(Boolean);
}

function isValidAccountId(accountId) {
  if (typeof accountId !== 'string' || accountId.length === 0) return false;
  for (let i = 0; i < accountId.length; i++) {
    const ch = accountId[i];
    const code = ch.charCodeAt(0);
    // 0-9
    if (code >= 48 && code <= 57) {
      // Valid digit
    } else if (code >= 65 && code <= 90) {
      // Valid uppercase letter
    } else if (code >= 97 && code <= 122) {
      // Valid lowercase letter
    } else if (ch === '-' || ch === '.' || ch === '@') {
      // Valid special character
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Validate date string YYYY-MM-DD format (no regex)
 * returns true if valid format and numbers in reasonable ranges
 */
function isValidDateFormat(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
  const [y, m, d] = parts;
  if (y.length !== 4 || m.length < 1 || m.length > 2 || d.length < 1 || d.length > 2) return false;
  const yi = parseInt(y, 10);
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  if (Number.isNaN(yi) || Number.isNaN(mi) || Number.isNaN(di)) return false;
  if (mi < 1 || mi > 12) return false;
  if (di < 1 || di > 31) return false;
  // Basic day check for months (not accounting leap years fully) — good enough for format check
  if ((mi === 4 || mi === 6 || mi === 9 || mi === 11) && di > 30) return false;
  if (mi === 2 && di > 29) return false;
  return true;
}

/**
 * Compare only date portion (UTC) of current date vs provided date string YYYY-MM-DD
 * returns:
 *  -1 if providedDate < today
 *   0 if equal
 *   1 if providedDate > today
 */
function compareDateToTodayUTC(dateStr) {
  // dateStr validated format YYYY-MM-DD
  const today = new Date();
  // build UTC date from dateStr
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
  const provided = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const currUTC = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0)
  );
  if (provided.getTime() < currUTC.getTime()) return -1;
  if (provided.getTime() === currUTC.getTime()) return 0;
  return 1;
}

/**
 * Parse instruction string according to the two formats without regex.
 * Return object:
 * {
 *  type: "DEBIT"|"CREDIT"|null,
 *  amount: int|null,
 *  currency: "USD"|...|null,
 *  debitAccount: string|null,
 *  creditAccount: string|null,
 *  executeBy: "YYYY-MM-DD"|null,
 *  parse_error: null|string (SY01/SY02/SY03) and message
 * }
 */
function parseInstruction(instruction) {
  if (!instruction || typeof instruction !== 'string') {
    return {
      type: null,
      amount: null,
      currency: null,
      debitAccount: null,
      creditAccount: null,
      executeBy: null,
      parse_error: { code: 'SY03', message: 'Malformed instruction: unable to parse keywords' },
    };
  }

  const original = instruction.trim();
  if (original.length === 0) {
    return {
      type: null,
      amount: null,
      currency: null,
      debitAccount: null,
      creditAccount: null,
      executeBy: null,
      parse_error: { code: 'SY03', message: 'Malformed instruction: empty' },
    };
  }

  // Prepare tokens and uppercase tokens for keyword checks
  const rawTokens = tokensFrom(original);
  const upTokens = rawTokens.map((t) => t.toUpperCase());

  const first = upTokens[0];
  if (first !== 'DEBIT' && first !== 'CREDIT') {
    return {
      type: null,
      amount: null,
      currency: null,
      debitAccount: null,
      creditAccount: null,
      executeBy: null,
      parse_error: {
        code: 'SY03',
        message: 'Malformed instruction: must start with DEBIT or CREDIT',
      },
    };
  }

  const type = first; // DEBIT or CREDIT

  // amount and currency should be tokens[1], tokens[2]
  if (upTokens.length < 3) {
    return {
      type: null,
      amount: null,
      currency: null,
      debitAccount: null,
      creditAccount: null,
      executeBy: null,
      parse_error: { code: 'SY03', message: 'Malformed instruction: missing amount or currency' },
    };
  }

  const amountToken = rawTokens[1];
  const currencyToken = upTokens[2]; // use uppercase for currency

  // amount must be positive integer (no decimals, no negatives)
  // Reject decimals by checking if contains '.' or not an integer
  if (amountToken.indexOf('.') !== -1) {
    return {
      type,
      amount: null,
      currency: currencyToken,
      debitAccount: null,
      creditAccount: null,
      executeBy: null,
      parse_error: { code: 'AM01', message: 'Amount must be a positive integer' },
    };
  }
  const amountNum = parseInt(amountToken, 10);
  if (!Number.isInteger(amountNum) || amountNum <= 0) {
    return {
      type,
      amount: null,
      currency: currencyToken,
      debitAccount: null,
      creditAccount: null,
      executeBy: null,
      parse_error: { code: 'AM01', message: 'Amount must be a positive integer' },
    };
  }

  // Now parse account locations depending on format
  let debitAccount = null;
  let creditAccount = null;
  let executeBy = null;

  if (type === 'DEBIT') {
    // Expect sequence: DEBIT [amount] [currency] FROM ACCOUNT [account_id] FOR CREDIT TO ACCOUNT [account_id] [ON date]
    // find "FROM" token index
    const fromIdx = upTokens.indexOf('FROM');
    if (fromIdx === -1 || upTokens[fromIdx + 1] !== 'ACCOUNT') {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount: null,
        creditAccount: null,
        executeBy: null,
        parse_error: {
          code: 'SY01',
          message: "Missing required keyword 'FROM ACCOUNT' in DEBIT format",
        },
      };
    }
    const debitIdx = fromIdx + 2;
    if (debitIdx >= rawTokens.length) {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount: null,
        creditAccount: null,
        executeBy: null,
        parse_error: { code: 'SY03', message: 'Malformed instruction: missing debit account id' },
      };
    }
    debitAccount = rawTokens[debitIdx];

    // find 'FOR' that leads to 'CREDIT'
    const forIdx = upTokens.indexOf('FOR', debitIdx + 1);
    if (
      forIdx === -1 ||
      upTokens[forIdx + 1] !== 'CREDIT' ||
      upTokens[forIdx + 2] !== 'TO' ||
      upTokens[forIdx + 3] !== 'ACCOUNT'
    ) {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount,
        creditAccount: null,
        executeBy: null,
        parse_error: {
          code: 'SY02',
          message: 'Invalid keyword order for CREDIT part in DEBIT format',
        },
      };
    }
    const creditIdx = forIdx + 4;
    if (creditIdx >= rawTokens.length) {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount,
        creditAccount: null,
        executeBy: null,
        parse_error: { code: 'SY03', message: 'Malformed instruction: missing credit account id' },
      };
    }
    creditAccount = rawTokens[creditIdx];

    // Optional ON date (search for ON after creditIdx)
    const onIdx = upTokens.indexOf('ON', creditIdx + 1);
    if (onIdx !== -1) {
      const dateToken = rawTokens[onIdx + 1];
      if (!dateToken) {
        return {
          type,
          amount: amountNum,
          currency: currencyToken,
          debitAccount,
          creditAccount,
          executeBy: null,
          parse_error: { code: 'DT01', message: 'Invalid date format or missing date after ON' },
        };
      }
      if (!isValidDateFormat(dateToken)) {
        return {
          type,
          amount: amountNum,
          currency: currencyToken,
          debitAccount,
          creditAccount,
          executeBy: null,
          parse_error: { code: 'DT01', message: 'Invalid date format, expected YYYY-MM-DD' },
        };
      }
      executeBy = dateToken;
    }
  } else {
    // type === "CREDIT"
    // Expect: CREDIT [amount] [currency] TO ACCOUNT [credit_id] FOR DEBIT FROM ACCOUNT [debit_id] [ON date]
    const toIdx = upTokens.indexOf('TO');
    if (toIdx === -1 || upTokens[toIdx + 1] !== 'ACCOUNT') {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount: null,
        creditAccount: null,
        executeBy: null,
        parse_error: {
          code: 'SY01',
          message: "Missing required keyword 'TO ACCOUNT' in CREDIT format",
        },
      };
    }
    const creditIdx = toIdx + 2;
    if (creditIdx >= rawTokens.length) {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount: null,
        creditAccount: null,
        executeBy: null,
        parse_error: { code: 'SY03', message: 'Malformed instruction: missing credit account id' },
      };
    }
    creditAccount = rawTokens[creditIdx];

    // find FOR DEBIT FROM ACCOUNT ...
    const forIdx = upTokens.indexOf('FOR', creditIdx + 1);
    if (
      forIdx === -1 ||
      upTokens[forIdx + 1] !== 'DEBIT' ||
      upTokens[forIdx + 2] !== 'FROM' ||
      upTokens[forIdx + 3] !== 'ACCOUNT'
    ) {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount: null,
        creditAccount,
        executeBy: null,
        parse_error: {
          code: 'SY02',
          message: 'Invalid keyword order for DEBIT part in CREDIT format',
        },
      };
    }
    const debitIdx = forIdx + 4;
    if (debitIdx >= rawTokens.length) {
      return {
        type,
        amount: amountNum,
        currency: currencyToken,
        debitAccount: null,
        creditAccount,
        executeBy: null,
        parse_error: { code: 'SY03', message: 'Malformed instruction: missing debit account id' },
      };
    }
    debitAccount = rawTokens[debitIdx];

    // Optional ON date
    const onIdx = upTokens.indexOf('ON', debitIdx + 1);
    if (onIdx !== -1) {
      const dateToken = rawTokens[onIdx + 1];
      if (!dateToken) {
        return {
          type,
          amount: amountNum,
          currency: currencyToken,
          debitAccount,
          creditAccount,
          executeBy: null,
          parse_error: { code: 'DT01', message: 'Invalid date format or missing date after ON' },
        };
      }
      if (!isValidDateFormat(dateToken)) {
        return {
          type,
          amount: amountNum,
          currency: currencyToken,
          debitAccount,
          creditAccount,
          executeBy: null,
          parse_error: { code: 'DT01', message: 'Invalid date format, expected YYYY-MM-DD' },
        };
      }
      executeBy = dateToken;
    }
  }

  // final parse checks: account id characters
  if (!isValidAccountId(debitAccount)) {
    return {
      type,
      amount: amountNum,
      currency: currencyToken,
      debitAccount,
      creditAccount,
      executeBy,
      parse_error: { code: 'AC04', message: 'Invalid account ID format for debit account' },
    };
  }
  if (!isValidAccountId(creditAccount)) {
    return {
      type,
      amount: amountNum,
      currency: currencyToken,
      debitAccount,
      creditAccount,
      executeBy,
      parse_error: { code: 'AC04', message: 'Invalid account ID format for credit account' },
    };
  }

  return {
    type,
    amount: amountNum,
    currency: currencyToken.toUpperCase(),
    debitAccount,
    creditAccount,
    executeBy: executeBy || null,
    parse_error: null,
  };
}

/**
 * Execute parsed instruction against provided accounts array
 * accounts: array of { id, balance, currency }
 *
 * Returns { httpStatus, body } where httpStatus is 200 or 400
 */
function handleInstruction(payload) {
  // parse first

  const parsed = parseInstruction(payload.instruction);
  console.log(parsed, 'parsed instruction');

  // unparseable instruction
  if (parsed.parse_error && parsed.parse_error.code === 'SY03') {
    return {
      httpStatus: 400,
      body: {
        type: null,
        amount: null,
        currency: null,
        debitAccount: null,
        creditAccount: null,
        executeBy: null,
        status: 'failed',
        status_reason: parsed.parse_error.message,
        status_code: 'SY03',
        accounts: [],
      },
    };
  }

  // If parse produced other parse errors (AM01, AC04, DT01, SY01, SY02), return 400 with parsed fields when possible
  if (parsed.parse_error) {
    const resp = {
      type: parsed.type || null,
      amount: parsed.amount || null,
      currency: parsed.currency || null,
      debitAccount: parsed.debitAccount || null,
      creditAccount: parsed.creditAccount || null,
      executeBy: parsed.executeBy || null,
      status: 'failed',
      status_reason: parsed.parse_error.message,
      status_code: parsed.parse_error.code,
      accounts: [],
    };

    // If we can attach the accounts (from request) in request order and they are present, include them unchanged
    const involved = payload.accounts.filter(
      (a) => a.id === parsed.debitAccount || a.id === parsed.creditAccount
    );
    if (involved.length > 0) {
      resp.accounts = involved.map((a) => ({
        id: a.id,
        balance: a.balance,
        balance_before: a.balance,
        currency: (a.currency || '').toUpperCase(),
      }));
    }

    return { httpStatus: 400, body: resp };
  }

  // parsed OK -> proceed with business validations
  const { type, amount, currency, debitAccount, creditAccount, executeBy } = parsed;

  // Find accounts in the request array in their original order (must preserve request order)
  const involved = payload.accounts.filter((a) => a.id === debitAccount || a.id === creditAccount);
  // If we don't have both accounts, return AC03
  const hasDebit = payload.accounts.some((a) => a.id === debitAccount);
  const hasCredit = payload.accounts.some((a) => a.id === creditAccount);
  if (!hasDebit || !hasCredit) {
    // build response with parsed fields and accounts present
    const accountsResp = involved.map((a) => ({
      id: a.id,
      balance: a.balance,
      balance_before: a.balance,
      currency: (a.currency || '').toUpperCase(),
    }));
    // status code AC03
    return {
      httpStatus: 400,
      body: {
        type,
        amount,
        currency,
        debitAccount,
        creditAccount,
        executeBy: executeBy || null,
        status: 'failed',
        status_reason: 'Account not found',
        status_code: 'AC03',
        accounts: accountsResp,
      },
    };
  }

  // Retrieve the two account objects (from request array) - preserve request order
  const acctA = payload.accounts.find((a) => a.id === debitAccount);
  const acctB = payload.accounts.find((a) => a.id === creditAccount);

  // Currency support
  if (!SUPPORTED_CURRENCIES.includes(currency.toUpperCase())) {
    return {
      httpStatus: 400,
      body: {
        type,
        amount,
        currency,
        debitAccount,
        creditAccount,
        executeBy: executeBy || null,
        status: 'failed',
        status_reason: `Unsupported currency. Only ${SUPPORTED_CURRENCIES.join(', ')} are supported`,
        status_code: 'CU02',
        accounts: [
          {
            id: acctA.id,
            balance: acctA.balance,
            balance_before: acctA.balance,
            currency: (acctA.currency || '').toUpperCase(),
          },
          {
            id: acctB.id,
            balance: acctB.balance,
            balance_before: acctB.balance,
            currency: (acctB.currency || '').toUpperCase(),
          },
        ],
      },
    };
  }

  // Currency must match between two accounts
  if ((acctA.currency || '').toUpperCase() !== (acctB.currency || '').toUpperCase()) {
    return {
      httpStatus: 400,
      body: {
        type,
        amount,
        currency,
        debitAccount,
        creditAccount,
        executeBy: executeBy || null,
        status: 'failed',
        status_reason: 'Account currency mismatch',
        status_code: 'CU01',
        accounts: [
          {
            id: acctA.id,
            balance: acctA.balance,
            balance_before: acctA.balance,
            currency: (acctA.currency || '').toUpperCase(),
          },
          {
            id: acctB.id,
            balance: acctB.balance,
            balance_before: acctB.balance,
            currency: (acctB.currency || '').toUpperCase(),
          },
        ],
      },
    };
  }

  // Debit and credit accounts must differ
  if (debitAccount === creditAccount) {
    return {
      httpStatus: 400,
      body: {
        type,
        amount,
        currency,
        debitAccount,
        creditAccount,
        executeBy: executeBy || null,
        status: 'failed',
        status_reason: 'Debit and credit accounts cannot be the same',
        status_code: 'AC02',
        accounts: [
          {
            id: acctA.id,
            balance: acctA.balance,
            balance_before: acctA.balance,
            currency: (acctA.currency || '').toUpperCase(),
          },
        ],
      },
    };
  }

  // If executeBy is provided, compare date
  if (executeBy) {
    const cmp = compareDateToTodayUTC(executeBy);
    if (cmp === 1) {
      // future -> pending, do not change balances
      // maintain the request order for accounts (must return only the two accounts in request order)
      const ordered = payload.accounts.filter(
        (a) => a.id === debitAccount || a.id === creditAccount
      );
      return {
        httpStatus: 200,
        body: {
          type,
          amount,
          currency,
          debitAccount,
          creditAccount,
          executeBy,
          status: 'pending',
          status_reason: 'Transaction scheduled for future execution',
          status_code: 'AP02',
          accounts: ordered.map((a) => ({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: (a.currency || '').toUpperCase(),
          })),
        },
      };
    }
    // else execute immediately (if same day or past)
  }

  // Immediate execution -> check sufficient funds in debit account
  if (acctA.balance < amount) {
    return {
      httpStatus: 400,
      body: {
        type,
        amount,
        currency,
        debitAccount,
        creditAccount,
        executeBy: executeBy || null,
        status: 'failed',
        status_reason: `Insufficient funds in debit account: has ${acctA.balance} ${acctA.currency || ''}, needs ${amount} ${currency}`,
        status_code: 'AC01',
        accounts: [
          {
            id: acctA.id,
            balance: acctA.balance,
            balance_before: acctA.balance,
            currency: (acctA.currency || '').toUpperCase(),
          },
          {
            id: acctB.id,
            balance: acctB.balance,
            balance_before: acctB.balance,
            currency: (acctB.currency || '').toUpperCase(),
          },
        ],
      },
    };
  }

  // PASS: execute debit and credit
  const beforeDebit = acctA.balance;
  const beforeCredit = acctB.balance;

  // Update balances (mutate copies, not original request objects)
  const newDebitBalance = beforeDebit - amount;
  const newCreditBalance = beforeCredit + amount;

  // Return success response (HTTP 200)
  // Keep accounts in request order and include only the two accounts
  const ordered = payload.accounts.filter((a) => a.id === debitAccount || a.id === creditAccount);
  const accountsResp = ordered
    .map((a) => {
      if (a.id === debitAccount) {
        return {
          id: a.id,
          balance: newDebitBalance,
          balance_before: beforeDebit,
          currency: (a.currency || '').toUpperCase(),
        };
      }
      if (a.id === creditAccount) {
        return {
          id: a.id,
          balance: newCreditBalance,
          balance_before: beforeCredit,
          currency: (a.currency || '').toUpperCase(),
        };
      }
      return null;
    })
    .filter(Boolean);

  return {
    httpStatus: 200,
    body: {
      type,
      amount,
      currency,
      debitAccount,
      creditAccount,
      executeBy: executeBy || null,
      status: 'successful',
      status_reason: 'Transaction executed successfully',
      status_code: 'AP00',
      accounts: accountsResp,
    },
  };
}

module.exports = { handleInstruction, parseInstruction };
