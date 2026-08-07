import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.session import Session
from app.models.user import User
from app.permissions import ROLE_PERMISSIONS
from app.schemas.auth import ChangePasswordRequest, LoginRequest, LoginResponse, MessageResponse
from app.schemas.user import UserResponse
from app.services.audit import AuditService
from app.services.auth import hash_password, verify_password
from app.services.password import validate_password_policy

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_login_count = (user.failed_login_count or 0) + 1
            if user.failed_login_count >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=15)
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked. Try again later.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    session_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(session_token)

    expires_at = datetime.utcnow() + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)

    session = Session(
        user_id=user.id,
        session_token_hash=token_hash,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        expires_at=expires_at,
    )
    db.add(session)

    user.last_login_at = datetime.utcnow()
    user.failed_login_count = 0
    user.locked_until = None

    await AuditService.log(
        db=db,
        action="auth.login",
        actor_user_id=user.id,
        actor_role_at_time=user.role,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.SESSION_EXPIRE_MINUTES * 60,
    )

    user_response = UserResponse.model_validate(user)
    user_response.permissions = ROLE_PERMISSIONS.get(user.role, [])

    return LoginResponse(
        message="Login successful",
        user=user_response,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    token = request.cookies.get("session_token")
    if token:
        token_hash = _hash_token(token)
        result = await db.execute(
            select(Session).where(Session.session_token_hash == token_hash)
        )
        session = result.scalar_one_or_none()
        if session:
            session.is_revoked = True

    await AuditService.log(
        db=db,
        action="auth.logout",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    response.delete_cookie("session_token")
    return MessageResponse(message="Logged out successfully")


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    user_response = UserResponse.model_validate(current_user)
    user_response.permissions = ROLE_PERMISSIONS.get(current_user.role, [])
    return user_response


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    valid, msg = validate_password_policy(body.new_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=msg,
        )

    current_user.password_hash = hash_password(body.new_password)
    current_user.must_change_password = False
    current_user.password_changed_at = datetime.utcnow()

    await AuditService.log(
        db=db,
        action="auth.change_password",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    return MessageResponse(message="Password changed successfully")
