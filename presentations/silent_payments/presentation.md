# Silent Payments

### A reusable Bitcoin address<br>without reusable on-chain addresses

<small>BIP 352</small>

Notes:
This is a technical dive, but the goal is to understand the machinery rather than memorize elliptic-curve formulas.

---

# Overview

1. The privacy problem
2. What a Silent Payment address contains
3. How sending and receiving work
4. Practical tradeoffs and wallet support

Notes:
Start with the motivation, then unpack the address and the calculations behind it. Finish with what this design costs in practice and where wallet support stands today.

---

# The problem

## Reusable addresses are convenient.<br>Address reuse is not private.

- A static address is easy to publish and works while you are offline
- Reusing it links every payment and exposes the payment history
- Fresh addresses preserve privacy but require coordination or an online server

Notes:
Use a donation page as the running example. Bob wants to publish one place to pay him. A normal address is convenient, but anyone can see every donation and the total balance. Generating a fresh address fixes that only if Bob or his infrastructure is online to hand it out.

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

<code class="address-example"><span class="address-prefix">sp1q</span><span class="address-scan">qd7h3mht4zhkd780tf2wnlq3cqudw5nzq955ghjvfq3fxrxx4xta</span><span class="address-boundary">c</span><span class="address-spend">qe7prvtsxvn4t6n3lzzntqxj35xsvpzfl76kuza3nwnkt5hg72cl5</span><span class="address-checksum">tjxtue</span></code>

<div class="address-legend"><span class="address-prefix">Prefix + version</span><span class="address-scan">Scan public key</span><span class="address-spend">Spend public key</span><span class="address-checksum">Checksum</span></div>

- Bech32m encoded
- `sp1q...` on mainnet
- 116 characters
- Two keys?

<small>The highlighted boundary character contains bits from both public keys.</small>

Notes:
The address carries two serialized public keys, 33 bytes each. It is longer than a normal Bitcoin address because it is a reusable payment instruction, not an output script. Version 0 appears as `q` after the separator. Bech32m converts bytes into 5-bit characters, so the boundary between the two keys falls inside one displayed character.

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

# Here be dragons

---

# Cryptography primer

```text
a          private key: a large number
G          secp256k1 generator point
A = a * G  public key: a point on the curve
```

- Lowercase letters are private numbers: `a`, `b_scan`, `b_spend`
- Uppercase letters are their public points: `A`, `B_scan`, `B_spend`
- Multiplying a point by a private number is simple
- Recovering the private number from the public point is not

Notes:
The star means scalar multiplication: repeatedly adding a curve point to itself, not ordinary multiplication. G is a fixed public starting point used by every secp256k1 key pair. Given a, deriving A is straightforward; given only A and G, recovering a is computationally infeasible.

Public points can also be added. This is why adding private input keys corresponds to adding their public keys later in the presentation.

---

# The cryptographic hinge

## Both sides can find the same secret

| Alice calculates                                           | Bob calculates                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| Alice's private input key<br>&times; Bob's public scan key | Alice's public input key<br>&times; Bob's private scan key |

Both calculations produce the **same shared point**.

Notes:
Alice has one private value and Bob's public point. Bob has the corresponding public point and his private value. The relationship between each private key and public key makes both calculations equal. An observer has only public values, which is not enough to reproduce the shared point.

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
# Aggregate the eligible private input keys
a = a_1 + a_2 + ... + a_n

# Derive the matching aggregate public key
A = a * G

# Bind the calculation to this transaction's inputs
input_hash = hash_BIP0352/Inputs(outpoint_L || A)

# Calculate the shared point
secret     = input_hash * a * B_scan

# Turn the shared point and counter into a tweak
t_k        = hash_BIP0352/SharedSecret(ser_P(secret) || ser_32(k))

# Add the tweak to the receiver's spend public key
P_k        = B_spend + t_k * G
```

Encode only the resulting public key `P_k` as a BIP 341 Taproot output.

Notes:
Walk from top to bottom. Alice aggregates the eligible private input keys into a, derives the corresponding public key A, and hashes A with the smallest input outpoint. She uses that input hash and Bob's scan public key to calculate the shared point, hashes it with counter k into a tweak, and adds the tweak to Bob's spend public key B_spend. The counter is an input to the derivation; it is not encoded separately in the output.

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

<small>Source: silentpayments.xyz, updated August 21, 2026</small>

| Send + receive   | Send only      | In progress  |
| ---------------- | -------------- | ------------ |
| BlindBit Desktop | BitBox         | Bitcoin Core |
| Cake Wallet      | BlueWallet*    | Unchained    |
| Dana Wallet      | Nunchuk Wallet |              |
| Sparrow Wallet   | Wasabi Wallet  |              |

<small>*BlueWallet receiving is in progress.</small>

Notes:
Agora and Tacit are applications with built-in wallets that support sending, receiving, and privacy-preserving scanning. The ecosystem is moving quickly and the support page warns users to be cautious with real funds.

Bitcoin Core has sending and receiving work in progress. Unchained has sending and BIP 375 support in progress, but not receiving.

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
<!-- .element: class="trade-offs" -->

## Better on-chain privacy,<br>heavier wallet engineering.

Notes:
This is the framing to leave with the audience. Silent Payments do not make complexity disappear. They relocate it from user interaction and visible blockchain messages into wallet cryptography and data access.

No Bitcoin consensus change is required; this is an application-layer protocol using existing transaction data and Taproot outputs.

---

# Questions?

<small>
BIP 352 · silentpayments.xyz
</small>

---

<!-- .slide: data-visibility="uncounted" -->

# Sources

- [BIP 352: Silent Payments](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki)
- [Silent Payments documentation](https://silentpayments.xyz/docs/)
- [Wallet support](https://silentpayments.xyz/docs/wallets/)
- [BIP 47: Reusable Payment Codes](https://github.com/bitcoin/bips/blob/master/bip-0047.mediawiki)
- [BIP 351: Private Payments](https://github.com/bitcoin/bips/blob/master/bip-0351.mediawiki)

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
P_k        = B_spend + t_k * G
```

Encode only the resulting public key `P_k` as a BIP 341 Taproot output.

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
