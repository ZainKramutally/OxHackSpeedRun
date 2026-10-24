; A deliberate bug: the lnd below claims the wrong condition.
; The reversible VM cannot check it (it keeps no history) and trusts it.
; The logging VM (the oracle) checks every landing and faults on the first one.
; Open the Comparison tab to see the two engines disagree.
        .code
start:  xori  r1, 4
top:    lnd   eq, r2, r0, back  ; BUG: should be "ne" (true iff we came from the back edge)
        addi  r3, 7
        addi  r2, 1
back:   br    ne, r2, r1, top
        hlt
