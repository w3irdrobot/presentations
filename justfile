default:
    just --list

run filename:
    @presenterm --publish-speaker-notes {{filename}}

run-speaker filename:
    @presenterm --listen-speaker-notes {{filename}}
