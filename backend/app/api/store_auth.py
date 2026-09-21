import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.ecommerce import CustomerAccount, EcommerceCustomerAddress as CustomerAddress, StoreSession
from app.models.user import User
from app.schemas.ecommerce import (
    AddressCreate,
    AddressResponse,
    CustomerRegister,
    CustomerLogin,
    CustomerResponse,
    CustomerUpdate,
)
from app.services.auth import hash_password, verify_password

router = APIRouter(prefix="/api/store/auth", tags=["store-auth"])

SESSION_COOKIE = "store_session"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _is_secure_request(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


async def _create_store_session(db: AsyncSession, customer_id: int, request: Request) -> str:
    token = secrets.token_urlsafe(48)
    session = StoreSession(
        customer_id=customer_id,
        session_token_hash=_hash_token(token),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.STORE_SESSION_EXPIRE_DAYS),
    )
    db.add(session)
    await db.flush()
    return token


def _set_session_cookie(response: Response, token: str, request: Request):
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.STORE_SESSION_EXPIRE_DAYS * 86400,
        httponly=True,
        secure=_is_secure_request(request),
        samesite="lax",
    )


async def _revoke_store_session(db: AsyncSession, token: str):
    result = await db.execute(
        select(StoreSession).where(StoreSession.session_token_hash == _hash_token(token))
    )
    session = result.scalar_one_or_none()
    if session:
        session.is_revoked = True


async def get_store_customer(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CustomerAccount | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None

    result = await db.execute(
        select(StoreSession).where(
            StoreSession.session_token_hash == _hash_token(token),
            StoreSession.is_revoked == False,
            StoreSession.expires_at > datetime.now(timezone.utc),
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        return None

    result = await db.execute(
        select(CustomerAccount).where(CustomerAccount.id == session.customer_id)
    )
    return result.scalar_one_or_none()


async def require_store_customer(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CustomerAccount:
    customer = await get_store_customer(request, db)
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please login to continue",
        )
    if not customer.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )
    return customer


@router.post("/register", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def register_customer(
    body: CustomerRegister,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    if len(body.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters",
        )

    existing = await db.execute(
        select(CustomerAccount).where(CustomerAccount.email == body.email.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    customer = CustomerAccount(
        email=body.email.lower(),
        full_name=body.full_name,
        phone=body.phone,
        password_hash=hash_password(body.password),
    )
    db.add(customer)
    await db.flush()

    token = await _create_store_session(db, customer.id, request)
    await db.commit()

    _set_session_cookie(response, token, request)
    return CustomerResponse.model_validate(customer)


@router.post("/login", response_model=CustomerResponse)
async def login_customer(
    body: CustomerLogin,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    identifier = body.email.strip().lower()

    is_email = "@" in identifier

    if is_email:
        result = await db.execute(
            select(CustomerAccount).where(CustomerAccount.email == identifier)
        )
        customer = result.scalar_one_or_none()
    else:
        customer = None

    if not customer:
        username = identifier if not is_email else body.email.strip()
        result = await db.execute(
            select(User).where(User.username == username)
        )
        user = result.scalar_one_or_none()
        if user and verify_password(body.password, user.password_hash):
            if not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account is deactivated",
                )
            existing = await db.execute(
                select(CustomerAccount).where(CustomerAccount.email == (user.email or f"{user.username}@obm.local"))
            )
            customer = existing.scalar_one_or_none()
            if not customer:
                customer = CustomerAccount(
                    email=user.email or f"{user.username}@obm.local",
                    full_name=user.full_name or user.username,
                    phone=user.phone,
                    password_hash=user.password_hash,
                )
                db.add(customer)
                await db.flush()
            user.last_login_at = datetime.now(timezone.utc)
            token = await _create_store_session(db, customer.id, request)
            await db.commit()
            _set_session_cookie(response, token, request)
            return CustomerResponse.model_validate(customer)

    if not customer or not verify_password(body.password, customer.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not customer.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    customer.last_login_at = datetime.now(timezone.utc)
    token = await _create_store_session(db, customer.id, request)
    await db.commit()

    _set_session_cookie(response, token, request)
    return CustomerResponse.model_validate(customer)


@router.post("/logout")
async def logout_customer(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await _revoke_store_session(db, token)
        await db.commit()
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=_is_secure_request(request),
        samesite="lax",
    )
    return {"message": "Logged out"}


@router.get("/me", response_model=CustomerResponse)
async def get_current_customer(customer: CustomerAccount = Depends(require_store_customer)):
    return CustomerResponse.model_validate(customer)


@router.patch("/me", response_model=CustomerResponse)
async def update_customer_profile(
    body: CustomerUpdate,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    if body.full_name is not None:
        customer.full_name = body.full_name
    if body.phone is not None:
        customer.phone = body.phone
    await db.commit()
    await db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.get("/addresses", response_model=list[AddressResponse])
async def list_addresses(
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CustomerAddress).where(CustomerAddress.customer_id == customer.id)
    )
    return [AddressResponse.model_validate(a) for a in result.scalars().all()]


@router.post("/addresses", response_model=AddressResponse, status_code=status.HTTP_201_CREATED)
async def create_address(
    body: AddressCreate,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    if body.is_default:
        existing = await db.execute(
            select(CustomerAddress).where(
                CustomerAddress.customer_id == customer.id,
                CustomerAddress.is_default == True,
            )
        )
        for addr in existing.scalars().all():
            addr.is_default = False

    address = CustomerAddress(customer_id=customer.id, **body.model_dump())
    db.add(address)
    await db.commit()
    await db.refresh(address)
    return AddressResponse.model_validate(address)


@router.delete("/addresses/{address_id}")
async def delete_address(
    address_id: int,
    customer: CustomerAccount = Depends(require_store_customer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CustomerAddress).where(
            CustomerAddress.id == address_id,
            CustomerAddress.customer_id == customer.id,
        )
    )
    address = result.scalar_one_or_none()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    await db.delete(address)
    await db.commit()
    return {"message": "Address deleted"}
