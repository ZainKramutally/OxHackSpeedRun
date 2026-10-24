; Procedures: call / proc / ret.
; CALL pushes the return address by XOR into a zero stack slot;
; RET pops it and zeroes the slot again, so nothing is lost.
        .code
start:  xori  r1, 5
        call  addto             ; r3 += r1
        call  addto
        call  triple            ; r3 += 3 * r1 via nested calls
        hlt
addto:  proc  addto_end
        add   r3, r1
addto_end:
        ret
triple: proc  triple_end
        call  addto
        call  addto
        call  addto
triple_end:
        ret
