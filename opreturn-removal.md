---
title: "BTeaC: Removing the OP_RETURN limit from Bitcoin Core"
author: "w3irdrobot"
theme:
    name: dark
---

Who are you?
============

<!-- column_layout: [3,2] -->
<!-- column: 0 -->

- Twitter: @w3irdrobot
- GitHub: @w3irdrobot
- Nostr: w3ird@w3ird.tech

<!-- column: 1 -->

![w3irdrobot Avatar](./images/avatar.png)

<!-- end_slide -->

Things we'll cover
==================

- The mempool, who decides what goes into it, and how that works
- Transaction relay and how transactions are filtered
- Block size vs block weight
- Bitcoin Script
- What `OP_RETURN` is
- Reasons for removing `OP_RETURN` limits
- Reasons for keeping `OP_RETURN` limits

<!-- end_slide -->

Things we won't cover
====================

- Core vs Knots
- JPEGs on the blockchain
- Mining centralization
- **My own opinion**

<!-- end_slide -->

The Mempool?
===========

![Mempool dot space](./images/mempool_space.png)

<!-- pause -->

This is not the mempool.
=======================

<!-- end_slide -->

The Mempool
===========

<!-- column_layout: [1,1] -->
<!-- column: 0 -->

![Mempool info](./images/mempool_info.png)

<!-- column: 1 -->

![Mempool sample](./images/mempool_sample.png)

<!-- reset_layout -->

- A cache of valid bitcoin transactions that have been broadcast to the network but have yet to be confirmed in a block
- Every node has its own mempool
- Transactions are sent from node to node until all nodes' mempools contain the transaction
- This includes miners, who also run a node with its own mempool from which they build blocks
- A node will receive a new block, validate it, and then remove any transactions from its mempool that are included in the block

<!--
speaker_note: |
    Default mempool size is 300mb
-->

<!-- end_slide -->

Transaction relay
================

- The rules around when a transaction will be added to the mempool and sent to other nodes
- Reasons for not relaying a transaction
  - Fail policy checks (filters)
  - Fail replacement checks
  - Fail consensus checks

<!-- pause -->

# What are filters?

- User-controlled rules for determining if a transaction should be added to the local mempool
- Bitcoin core ships with a set of default filters
- Examples
  - Minimium fee rate
  - Replace-by-fee
  - Dust limit
  - `OP_RETURN` limit

<!-- end_slide -->


Block size vs block weight
==========================

- Block size is the size of the block data on disk
- Block weight is a metric for determining how much data can fit into a block
- Prior to Segwit, block size was used and capped at 1MB
- With the introduction of Segwit (BIP141), blocks are measured in weight units with a max of 4 million weight units per block
- Block weight is defined as Base size * 3 + Total size
  - Base size is the block size in bytes with the original transaction serialization without any witness-related data, as seen by a non-upgraded node.
  - Total size is the block size in bytes with transactions serialized as described in BIP144, including base data and witness data.
- Under this system, the signature data within a transaction receives a “discount,” making it less costly compared to other types of transaction data. This means that signature data doesn’t "weigh" as much in a block.

<!-- end_slide -->

Bitcoin Script
==============

- A simple, stack-based scripting system for defining the conditions under which a transaction output can be spent
- Used in the ScriptPubKey and ScriptSig of a transaction
- It is evaluated from left to right and is purposefully not Turing complete
- Each program is a list of instructions called op codes
- These op codes are well defined and limited to a small set of operations
- One of the well-known op codes is `OP_RETURN`

**Important note: scripts are limited to a max of 10,000 bytes**

<!-- end_slide -->

What is OP_RETURN?
=================

- A Bitcoin Script op code that can be used to store data inside transactions
- Immediately ends the execution of the script and marks it as invalid, making the output provably unspendable
- Also used to refer to a standard script pattern used for storing arbitrary data inside transactions

<!-- pause -->

```
OP_RETURN
OP_PUSHBYTES_11
68656c6c6f20776f726c64
```
<!-- speaker_note: |
- hex is "hello world"
-->

<!-- pause -->

## Uses:

- Storing ASCII text
- Commit to Merkle roots representing document or file hashes (OpenTimestamps)
- Proposed identity schemes that commit public keys or challenge-response data via `OP_RETURN` (DID btcr2 method)
- Signaling and sidechain coordination messages (Drivechain)

<!-- end_slide -->

OP_RETURN examples
==================

![Happy Birthday](./images/op_return_happy_birthday.png)

<!-- alignment: center -->

https://mempool.space/tx/a45497518d0a35e855728cc25f0d65de95c4dd9ebc9878bbf02c686f8c9208aa

<!-- end_slide -->

OP_RETURN examples
==================

![Deez nuts](./images/op_return_deez_nuts.png)

<!-- alignment: center -->

https://mempool.space/tx/0c18049943842ba204356a75baa019e1942eeb1a495944955f4b42b00b6eb14a

<!-- end_slide -->

OP_RETURN examples
==================

![Hello, Cincinnati](./images/op_return_hello_cincy.png)

<!-- alignment: center -->

https://mempool.space/tx/d1c8943df225c8ba028f121e8e0923ea7d55edb9fed2e3c83a3470dcba7c2ba4

<!-- end_slide -->

What's the controversy?
======================

# How it was

- Bitcoin Core originally introduced a standard locking script as a compromise to allow people to include arbitrary data inside transactions
- This signaled that the UTXO was unspendable
- The limit was set at 80 bytes
- Bitcoin Core v0.9.0 reduced this to 40 bytes
- Bitcoin Core v0.11.0 raised the limit to 80 bytes

<!-- pause -->

## How it is now

- Bitcoin Core v30 removed the limit entirely
- This means the limit is no longer set by a relay policy and instead is restricted purely by consensus rules

<!-- speaker_note: |
  Less than 10,000 bytes per script
  Less than 4MB per block
-->

<!-- end_slide -->

Reasoning for removal
=====================================

<!-- pause -->

# Many legitimate use cases (like Merkle root proofs, cross-chain commits, or compact binary metadata) exceed 80 bytes

- Projects must split data across multiple transactions or compress data, adding unnecessary complexity.
- Example: OpenTimestamps has to pack large Merkle roots carefully to stay under 80 bytes.

<!-- pause -->

# The OP_RETURN limit is a relay and mining policy, not a consensus rule

- This distinction confuses developers — a transaction can be valid but still non-standard and therefore not relayed or mined by default nodes.
- Leads to frustration for app developers who find their valid transactions ignored by the network.

<!-- end_slide -->

Reasoning for removal
=====================================

# Because the limit is a policy, miners can override it - some allow larger payloads, others don’t

- Creates inconsistent propagation behavior.
- Developers can’t rely on uniform handling across the network.

<!-- pause -->

# Critics argue the 80-byte cap doesn’t meaningfully reduce spam

- One of the original justifications for limiting OP_RETURN was to prevent “blockchain spam” — users storing arbitrary files or text on-chain.
- However, it just pushes people toward worse methods (like fake multisig outputs) to store data.
- The limit doesn’t prevent abuse; it only penalizes legitimate structured use cases.

<!-- end_slide -->

Reasoning for removal
=====================================

# Some miners and relay nodes profit from accepting high-fee, large OP_RETURN data transactions (e.g., Ordinals, inscriptions), while others see them as spam

- Creates policy fragmentation and unpredictable mempool behavior.
- Reinforces centralization pressure since large miners can selectively mine “non-standard” payloads.

<!-- end_slide -->

Reasons for keeping
===================

<!-- pause -->

# Storing arbitrary data directly in Bitcoin blocks consumes space permanently

- Large or unlimited OP_RETURN outputs could significantly increase blockchain size, making full nodes heavier to run.

<!-- pause -->

# Without a limit, anyone could flood the network with huge OP_RETURN outputs

- Even if consensus allows it, the mempool could become clogged with low-fee “data spam” transactions.

<!-- end_slide -->

Reasons for keeping
===================

# While OP_RETURN outputs are provably unspendable (don’t increase UTXO growth), very large outputs still contribute to transaction size and affect block propagation times

- Keeping a limit avoids excessive bandwidth and memory overhead in validating and relaying blocks.

<!-- pause -->

# Large OP_RETURN outputs increase transaction weight, so keeping them small helps prevent fee market distortion

- If users could include megabytes of data for small fees, this might interfere with normal payments and smart fee estimation.

<!-- end_slide -->

Reasons for keeping
===================

# A size limit forces developers to use compact, structured, and binary encodings rather than bloated ASCII strings or redundant data

<!-- pause -->

# Keeping a standard limit reduces the variance between nodes and miners

- Without a default limit, some miners might accept arbitrarily large OP_RETURNs while others reject them, creating non-standard transaction propagation issues.

<!-- pause -->

# By limiting OP_RETURN size, developers and miners retained some control over how the blockchain could be used for arbitrary data, balancing between utility and keeping Bitcoin focused on payments and financial settlement

<!-- end_slide -->

<!-- jump_to_middle -->

Historically, Bitcoin Core’s 80-byte limit was seen as a compromise: large enough to store hashes and protocol identifiers, small enough to reduce the risk of abuse.

<!-- end_slide -->

<!-- jump_to_middle -->

"I don't like it. What can I do?"
=================================

<!-- end_slide -->

<!-- new_lines: 8 -->
<!-- list_item_newlines: 3 -->

- Don't upgrade to Core v30

<!-- pause -->

- Use a different node implementation (Knots, btcd, etc.)

<!-- pause -->

- `-datacarriersize=83`

<!-- end_slide -->

<!-- jump_to_middle -->

Questions?
=========
