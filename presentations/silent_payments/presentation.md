# Silent Payments

### A reusable Bitcoin address<br>without reusable on-chain addresses

<small>BIP 352</small>

Notes:
This is a technical dive, but the goal is to understand the machinery rather than memorize elliptic-curve formulas.

---

# The problem

## Receive now, stay private later

| One normal address     | Fresh addresses                 |
| ---------------------- | ------------------------------- |
| Easy to publish        | Harder to coordinate            |
| Works while offline    | Receiver or server must respond |
| Payments link on-chain | Payments remain separate        |

Notes:
Use a donation page as the running example. Bob wants to publish one place to pay him. A normal address is convenient, but anyone can see every donation and the total balance. Generating a fresh address fixes that only if Bob or his infrastructure is online to hand it out.

---

# What Silent Payments promise

> A static payment address without on-chain linkability of payments or a need for on-chain notifications.

- Publish **one** address
- Receive at a **new Taproot output** every time
- Add **no notification transaction**
- Add **no extra transaction data**

Notes:
This is BIP 352's central promise. The reusable address is communicated off-chain, but it never appears in a transaction. Each payer transforms it into a unique destination.

---

# A Silent Payment address

```text
sp1qqd7h3mht4zhkd780tf2wnlq3cqudw5nzq955ghjvfq3fxrxx4x
tacqe7prvtsxvn4t6n3lzzntqxj35xsvpzfl76kuza3nwnkt5hg72cl5tjxtue
```

```text
sp  +  version 0  +  scan public key  +  spend public key
```

- Bech32m encoded
- `sp1q...` on mainnet
- 116 characters

Notes:
The address carries two SEC1 compressed public keys, 33 bytes each. It is longer than a normal Bitcoin address because it is a reusable payment instruction, not an output script. Version 0 uses `q`

---

# Why two keys?

| Scan key                     | Spend key                 |
| ---------------------------- | ------------------------- |
| Recognizes incoming payments | Authorizes spending       |
| Online / hot                 | Can remain offline / cold |
| Privacy-sensitive            | Money-sensitive           |

The public halves of both keys are safe to publish.

Notes:
The receiver must repeatedly test transactions, so the private scan key needs to be available to a scanner. Separating the keys means the spend private key can stay on a hardware signer or offline device. A stolen scan key reveals which outputs belong to Bob, but cannot spend them by itself.

---

# Earlier approaches

| Proposal                 | How the receiver learns                  |
| ------------------------ | ---------------------------------------- |
| BIP 63 Stealth Addresses | `OP_RETURN` notification                 |
| BIP 47 Payment Codes     | Initial notification transaction         |
| BIP 351 Private Payments | Sender-specific `OP_RETURN` notification |

Notes:
Keep this concise. BIP 47 establishes a relationship through a transaction to a notification address. BIP 351 removes that common recipient notification anchor, but still uses an on-chain notification. Silent Payments ask whether the transaction already contains enough public information to make notification implicit.

---

# The cryptographic hinge

## Both sides can find the same secret

| Alice calculates                                           | Bob calculates                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| Alice's private input key<br>&times; Bob's public scan key | Alice's public input key<br>&times; Bob's private scan key |

Both calculations produce the **same shared point**.

Notes:
Private keys are large numbers; public keys are points derived from them. Alice has one private value and Bob's public value. Bob has the corresponding public value and his private value. The relationship between each private key and public key makes both calculations equal. An observer has only public values, which is not enough to reproduce the shared point.

The simplified identity is a * B_scan = b_scan * A. This symmetry is the core of the protocol.

---

# Which inputs participate?

The transaction must contain at least one eligible input:

- P2TR
- P2WPKH
- P2SH-P2WPKH
- P2PKH

The sender needs the corresponding private key.
The receiver must be able to recover its public key.

Notes:
Other inputs may fund the transaction, but they are ignored for shared-secret derivation. Inputs with ambiguous branches or multiple possible public keys are excluded because changing the key after output derivation could make the payment undiscoverable.

---

# Many inputs, one aggregate key

```text
Private side:  input key 1 + input key 2 + input key 3
                              | mathematically corresponds
Public side:   input key 1 + input key 2 + input key 3
```

- One aggregate key per transaction
- One shared-point calculation per receiver group
- No need to reveal which input belongs to the payer

Notes:
The sender adds eligible private keys. The receiver extracts and adds their public keys. Elliptic-curve key addition preserves the correspondence between the two sums.

Using all inputs reduces receiver work compared with checking each input separately. It also avoids telling Bob which input was Alice's in a collaborative transaction. BIP 352 still recommends that inputs belong to one entity because the general collaborative setting lacks a formal security proof.

---

# Make this payment unique

The shared secret is bound to:

```text
aggregate input key + smallest input outpoint + output counter
```

- The **outpoint** identifies a coin being spent
- New coins produce a new destination
- Counter `k` allows several outputs to one recipient

Notes:
The shared point alone could repeat if Alice reused the same input key. BIP 352 hashes the aggregate key with the lexicographically smallest outpoint, creating a transaction-specific input hash. Hashing the shared secret with counter k then supports multiple distinct outputs in the same transaction.

The smallest outpoint is deterministic regardless of input ordering and is convenient for memory-constrained hardware devices.

---

# Sending

```text
Bob's Silent Payment address
            |
   scan key + spend key
            |
eligible inputs
      |
aggregate input key + smallest input outpoint
      |
calculate input hash
      |
shared point + input hash + counter k
      |
hash into a tweak -> spend public key + tweak
                              |
                    Taproot output key
```

Notes:
Walk from top to bottom. Alice parses Bob's two public keys, selects inputs, aggregates their private keys, and derives the shared point with Bob's scan public key. She binds it to the input hash, hashes it with k, and adds that tweak to Bob's spend public key.

Conceptual formula: P_k = B_spend + hash(input_hash * shared_secret || k) * G.

---

# What appears on-chain?

```text
Transaction
+----------------------+----------------------+
| ordinary inputs      | ordinary P2TR output |
+----------------------+----------------------+
```

No `OP_RETURN` · No payment code · No protocol marker

An observer cannot connect the output to Bob's published address.

Notes:
The output is a BIP 341 Taproot output. It carries only the derived output key, not Bob's Silent Payment address. There is no size or fee overhead attributable to a notification. Its privacy depends on blending into the broader Taproot anonymity set.

---

# Receiving means scanning

For each eligible transaction, Bob's wallet:

1. Collects and aggregates public input keys
2. Recreates the transaction-specific shared secret
3. Derives candidate Taproot output keys
4. Compares candidates with the transaction's outputs
5. Records any match and its tweak

Notes:
This is the inversion of sending. Bob computes the same input hash from public transaction data, then combines his private scan key with the aggregate public input key. Because both sides derive the same shared point, Bob recreates Alice's candidate output.

Scanning is required only for transactions with at least one Taproot output and one eligible input. Version 0 also skips transactions spending an input with a future SegWit version greater than 1.

---

# Why scanning stops

```text
k = 0 -> candidate found? -> yes -> try k = 1
                          -> no  -> stop
```

- Outputs may appear in any transaction order
- A missing next candidate ends the sequence
- A safety limit stops at `k = 2^32 - 1`

Notes:
The counter describes derivation order, not transaction output position. Bob checks all relevant outputs for candidate zero. A match means Alice may have made another output, so Bob increments k. The first miss stops the search. The protocol's upper bound is 2^32 - 1.

---

# Labels

```text
same scan key + labeled spend key
```

- Distinguish a website, invoice, or campaign
- Do not add one full blockchain scan per label
- Allow the wallet to identify the payment's source
- Label `0` is reserved for change

**Not separate identities:** published labels share a scan public key.

Notes:
A label is another deterministic tweak to the spend public key. During scanning, Bob first derives the unlabeled candidate, subtracts it from unmatched outputs, and checks whether the difference is one of his label tweaks.

Anyone comparing two published labeled addresses can see the same scan public key, so labels organize incoming payments; they do not hide that the addresses share an owner.

---

# Spending

```text
spend private key
       +
per-payment tweak
       +
optional label tweak
       =
private key for the Taproot output
```

The result is an ordinary Taproot key-path spend.

Notes:
Scanning saved the tweak that created the matched output. The signing wallet adds it to Bob's spend private key, plus the label tweak if one was used. This produces the private key corresponding to the on-chain output key.

This is why the scan key cannot spend alone and the spend key cannot independently discover outputs.

---

# What do we gain?

- One static address without on-chain address reuse
- No receiver interaction or address server
- No notification transaction or protocol fingerprint
- No extra transaction bytes or fees
- No automatic linking of repeat payments from one sender
- Scan and spend responsibilities can be separated

Notes:
Silent Payments improve both receiver and sender privacy. Unlike relationship-based notification schemes, Bob does not necessarily learn that two payments came from the same Alice. Backup can use existing seed and descriptor approaches.

---

# What does it cost?

- Receivers must scan relevant blockchain activity
- Private light clients need bandwidth or new infrastructure
- Giving a server the scan key reveals payment history to it
- Outputs are Taproot-only
- Hardware signing needs additional PSBT support
- Collaborative transactions add coordination and security complexity

Notes:
There is no free lunch. The work removed from recipient interaction and on-chain notification becomes scanning work. A full node can perform it locally. A light client either downloads more data, uses specialized indexes, or delegates scanning and weakens privacy.

The sender must not use SIGHASH_ANYONECANPAY because adding inputs after output derivation changes the shared secret and makes the payment undiscoverable.

---

# Wallet support

<small>Source: silentpayments.xyz, updated July 4, 2026</small>

| Send + receive   | Send only / receive pending |
| ---------------- | --------------------------- |
| BlindBit Desktop | BitBox                      |
| Cake Wallet      | BlueWallet*                 |
| Dana Wallet      | Nunchuk Wallet              |
| Sparrow Wallet   | Wasabi Wallet               |

<small>*BlueWallet receiving is in progress. Bitcoin Core support is in progress.</small>

Notes:
Agora also supports sending, receiving, and privacy-preserving scanning for its donation and crowdfunding application. The ecosystem is moving quickly and the support page warns users to be cautious with real funds.

"Privacy-preserving scanning" means the backend is not given information identifying the user's outputs.

---

# Hardware and infrastructure

- **BitBox02:** sending supported
- **Coldcard, Krux, SeedSigner:** support in progress
- **BIP 375:** PSBT fields for sending
- **BIP 376:** PSBT fields for spending received outputs
- **Silentium:** experimental light-wallet proof of concept

Notes:
Hardware signers do not scan the chain themselves; a paired software wallet does. The signer must nevertheless understand enough data to safely derive or authorize the right output and spend key. Silentium demonstrates a possible light-client direction but explicitly warns against use with meaningful funds.

---

# The trade

```text
fresh-address coordination        sender key derivation
on-chain notification       ->    receiver scanning
protocol fingerprint              ordinary Taproot output
```

## Better on-chain privacy,<br>heavier wallet engineering.

Notes:
This is the framing to leave with the audience. Silent Payments do not make complexity disappear. They relocate it from user interaction and visible blockchain messages into wallet cryptography and data access.

No Bitcoin consensus change is required; this is an application-layer protocol using existing transaction data and Taproot outputs.

---

# Takeaways

1. One reusable identifier creates a unique destination per payment
2. Sender and receiver independently derive the same hidden tweak
3. On-chain, the result looks like an ordinary Taproot output
4. Scanning is the price of removing interaction and notifications
5. Wallet support exists, but integration is still maturing

---

# Questions?

<small>
BIP 352 · silentpayments.xyz
</small>

---

<!-- .slide: data-visibility="uncounted" -->

# Appendix: notation

| Symbol               | Meaning                            |
| -------------------- | ---------------------------------- |
| `a`, `A`             | Aggregate input private/public key |
| `b_scan`, `B_scan`   | Receiver scan private/public key   |
| `b_spend`, `B_spend` | Receiver spend private/public key  |
| `G`                  | secp256k1 generator point          |
| `k`                  | Output counter, beginning at zero  |
| `m`                  | Optional label index               |

Notes:
Lowercase letters are private scalars; uppercase letters are public curve points. Multiplying a private scalar by G derives its public key.

---

<!-- .slide: data-visibility="uncounted" -->

# Appendix: address construction

```text
B_m = B_spend
    + hash_BIP0352/Label(ser_256(b_scan) || ser_32(m)) * G

address = bech32m(
  "sp",
  version 0 || ser_P(B_scan) || ser_P(B_m)
)
```

`B_m = B_spend` when no label is used.

---

<!-- .slide: data-visibility="uncounted" -->

# Appendix: sending derivation

```text
a = a_1 + a_2 + ... + a_n
A = a * G

input_hash = hash_BIP0352/Inputs(outpoint_L || A)
secret     = input_hash * a * B_scan
t_k        = hash_BIP0352/SharedSecret(ser_P(secret) || ser_32(k))
P_m,k      = B_m + t_k * G
```

Encode `P_m,k` as a BIP 341 Taproot output.

---

<!-- .slide: data-visibility="uncounted" -->

# Appendix: scanning derivation

```text
A = A_1 + A_2 + ... + A_n

input_hash = hash_BIP0352/Inputs(outpoint_L || A)
secret     = input_hash * b_scan * A
t_k        = hash_BIP0352/SharedSecret(ser_P(secret) || ser_32(k))
P_k        = B_spend + t_k * G
```

Compare `P_k` and its labeled variants with every P2TR output.

---

<!-- .slide: data-visibility="uncounted" -->

# Appendix: spending derivation

```text
label_m = hash_BIP0352/Label(
  ser_256(b_scan) || ser_32(m)
)

d = (b_spend + t_k + label_m) mod n
```

Without a label:

```text
d = (b_spend + t_k) mod n
```

Use `d` to spend the BIP 341 output.

---

<!-- .slide: data-visibility="uncounted" -->

# Sources

- [BIP 352: Silent Payments](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki)
- [Silent Payments documentation](https://silentpayments.xyz/docs/)
- [Wallet support](https://silentpayments.xyz/docs/wallets/)
- [BIP 47: Reusable Payment Codes](https://github.com/bitcoin/bips/blob/master/bip-0047.mediawiki)
- [BIP 351: Private Payments](https://github.com/bitcoin/bips/blob/master/bip-0351.mediawiki)
